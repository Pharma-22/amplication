import { GET_COMMITS } from "./commitQueries";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Commit,
  PendingChange,
  SortOrder,
  Build,
  EnumBuildStatus,
} from "../../models";
import { ApolloError, useLazyQuery, useMutation } from "@apollo/client";
import { cloneDeep, groupBy } from "lodash";
import { COMMIT_CHANGES } from "../Commit";
import { GraphQLErrorCode } from "@amplication/graphql-error-codes";
import { AppContext } from "../../context/appContext";
import { commitPath } from "../../util/paths";
import { useHistory } from "react-router-dom";

const MAX_ITEMS_PER_LOADING = 20;
const POLL_INTERVAL = 3000;

export type CommitChangesByResource = (commitId: string) => {
  resourceId: string;
  changes: PendingChange[];
}[];

type TData = {
  commit: Commit;
};

export interface CommitUtils {
  commits: Commit[];
  lastCommit: Commit;
  commitsError: ApolloError;
  commitsLoading: boolean;
  commitChangesByResource: (commitId: string) => {
    resourceId: string;
    changes: PendingChange[];
  }[];
  refetchCommitsData: (refetchFromStart?: boolean) => void;
  refetchLastCommit: () => void;
  updateBuildStatus: (build: Build) => void;
  disableLoadMore: boolean;
}

const useCommits = (currentProjectId: string, maxCommits?: number) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [lastCommit, setLastCommit] = useState<Commit>();
  const [commitsCount, setCommitsCount] = useState(1);
  const [disableLoadMore, setDisableLoadMore] = useState(false);
  const [isOpenLimitationDialog, setOpenLimitationDialog] = useState(false);
  const history = useHistory();

  const {
    setCommitRunning,
    resetPendingChanges,
    setPendingChangesError,
    currentWorkspace,
    currentProject,
    commitUtils,
  } = useContext(AppContext);

  const updateBuildStatus = useCallback(
    (build: Build) => {
      const clonedCommits = cloneDeep(commits);
      //find the commit that contains the build
      const commitIdx = getCommitIdx(clonedCommits, build.commitId);
      if (commitIdx === -1) return;
      const commit = clonedCommits[commitIdx];

      //find the build in the commit
      const buildIdx = commit.builds.findIndex((b) => b.id === build.id);
      if (buildIdx === -1) return;
      const builds = [...commit.builds];

      //update the build status if it changed
      if (builds[buildIdx].status === build.status) {
        return;
      }

      builds[buildIdx].status = build.status;
      builds[buildIdx].action = build.action;

      setCommits(clonedCommits);
      if (lastCommit.id === build.commitId) {
        setLastCommit(commit);
      }
    },
    [commits, lastCommit]
  );

  const [
    getLastCommit,
    {
      data: getLastCommitData,
      startPolling: getLastCommitStartPolling,
      stopPolling: getLastCommitStopPolling,
    },
  ] = useLazyQuery<{ commits: Commit[] }>(GET_COMMITS, {
    variables: {
      projectId: currentProjectId,
      skip: 0,
      take: 1,
      orderBy: {
        createdAt: SortOrder.Desc,
      },
    },
  });

  useEffect(() => {
    let shouldPoll = false;

    if (lastCommit && lastCommit.builds && lastCommit.builds.length > 0) {
      const runningBuilds = lastCommit.builds.some(
        (build) => build.status === EnumBuildStatus.Running
      );
      if (runningBuilds) {
        shouldPoll = true;
      }
    }

    if (shouldPoll) {
      getLastCommitStartPolling(POLL_INTERVAL);
    } else {
      getLastCommitStopPolling();
    }
    getLastCommitData && setLastCommit(getLastCommitData.commits[0]);
  }, [
    getLastCommitData,
    getLastCommitStopPolling,
    getLastCommitStartPolling,
    updateBuildStatus,
    lastCommit,
  ]);

  //cleanup polling
  useEffect(() => {
    return () => {
      getLastCommitStopPolling();
    };
  }, [getLastCommitStopPolling]);

  const formatLimitationError = (errorMessage: string) => {
    const LIMITATION_ERROR_PREFIX = "LimitationError: ";

    const limitationError = errorMessage.split(LIMITATION_ERROR_PREFIX)[1];
    return limitationError;
  };

  //commits mutation
  const [commit, { error: commitChangesError, loading: commitChangesLoading }] =
    useMutation<TData>(COMMIT_CHANGES, {
      onError: (error: ApolloError) => {
        setCommitRunning(false);
        setPendingChangesError(true);

        setOpenLimitationDialog(
          error?.graphQLErrors?.some(
            (gqlError) =>
              gqlError.extensions.code ===
              GraphQLErrorCode.BILLING_LIMITATION_ERROR
          ) ?? false
        );
      },
      onCompleted: (response) => {
        setCommitRunning(false);
        setPendingChangesError(false);
        resetPendingChanges();
        commitUtils.refetchCommitsData(true);
        const path = commitPath(
          currentWorkspace?.id,
          currentProject?.id,
          response.commit.id
        );
        return history.push(path);
      },
    });

  const commitChanges = useCallback(
    (data) => {
      if (!data) return;
      commit({
        variables: {
          message: data.message,
          projectId: currentProject?.id,
          bypassLimitations: data.bypassLimitations ?? false,
        },
      }).catch(console.error);
    },
    [commit, currentProject?.id]
  );

  const commitChangesLimitationError = useMemo(() => {
    if (!commitChangesError) return;
    const limitation = commitChangesError?.graphQLErrors?.find(
      (gqlError) =>
        gqlError.extensions.code === GraphQLErrorCode.BILLING_LIMITATION_ERROR
    );

    limitation.message = formatLimitationError(commitChangesError.message);
    return limitation;
  }, [commitChangesError]);

  //ends commits mutation

  const [
    getInitialCommits,
    {
      data: commitsData,
      error: commitsError,
      loading: commitsLoading,
      refetch: refetchCommits,
    },
  ] = useLazyQuery(GET_COMMITS, {
    notifyOnNetworkStatusChange: true,
    variables: {
      projectId: currentProjectId,
      take: maxCommits || MAX_ITEMS_PER_LOADING,
      skip: 0,
      orderBy: {
        createdAt: SortOrder.Desc,
      },
    },
    onCompleted: (data) => {
      if (!data?.commits.length || data?.commits.length < MAX_ITEMS_PER_LOADING)
        setDisableLoadMore(true);
    },
  });

  // get initial commits for a specific project
  useEffect(() => {
    if (!currentProjectId) return;

    getInitialCommits();
    commitsCount !== 1 && setCommitsCount(1);
  }, [currentProjectId]);

  // fetch the initial commit data and assign it
  useEffect(() => {
    if (!commitsData && !commitsData?.commits.length) return;

    if (commits.length) return;

    if (commitsLoading) return;

    setCommits(commitsData?.commits);
    setLastCommit(commitsData?.commits[0]);
  }, [commitsData?.commits, commits]);

  //refetch next page of commits, or refetch from start
  const refetchCommitsData = useCallback(
    (refetchFromStart?: boolean) => {
      refetchCommits({
        skip: refetchFromStart ? 0 : commitsCount * MAX_ITEMS_PER_LOADING,
        take: MAX_ITEMS_PER_LOADING,
      });
      refetchFromStart && setCommits([]);
      setCommitsCount(refetchFromStart ? 1 : commitsCount + 1);
    },
    [refetchCommits, setCommitsCount, commitsCount]
  );

  //refetch from the server the most updated commit
  const refetchLastCommit = useCallback(() => {
    if (!currentProjectId) return;

    refetchCommits({
      skip: 0,
      take: 1,
    });
  }, [currentProjectId]);

  // pagination refetch - we received an updated list from the server, and we need to append it to the current list
  useEffect(() => {
    if (!commitsData?.commits?.length || commitsCount === 1 || commitsLoading)
      return;

    setCommits([...commits, ...commitsData.commits]);
  }, [commitsData?.commits, commitsCount]);

  // last commit refetch
  useEffect(() => {
    //check if the data from the server contains a single commit
    if (!commitsData?.commits?.length || commitsData?.commits?.length > 1)
      return;

    setLastCommit(commitsData?.commits[0]);
  }, [commitsData?.commits]);

  const getCommitIdx = (commits: Commit[], commitId: string): number =>
    commits.findIndex((commit) => commit.id === commitId);

  const commitChangesByResource = useMemo(
    () => (commitId: string) => {
      const commitIdx = getCommitIdx(commits, commitId);
      const changesByResource = groupBy(
        commits[commitIdx]?.changes,
        (originChange) => {
          if (!originChange.resource) return;
          return originChange.resource.id;
        }
      );
      return Object.entries(changesByResource).map(([resourceId, changes]) => {
        return {
          resourceId,
          changes,
        };
      });
    },
    [commits]
  );

  return {
    commits,
    lastCommit,
    commitsError,
    commitsLoading,
    commitChangesByResource,
    refetchCommitsData,
    refetchLastCommit,
    disableLoadMore,
    updateBuildStatus,
    isOpenLimitationDialog,
    commitChanges,
    commitChangesError,
    commitChangesLoading,
    commitChangesLimitationError,
  };
};

export default useCommits;
