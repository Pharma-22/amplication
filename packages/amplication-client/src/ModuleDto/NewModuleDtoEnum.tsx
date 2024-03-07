import {
  Dialog,
  EnumTextAlign,
  Snackbar,
  Text,
  TextField,
} from "@amplication/ui/design-system";
import { Form, Formik } from "formik";
import { pascalCase } from "pascal-case";
import { useCallback, useContext, useState } from "react";
import { GlobalHotKeys } from "react-hotkeys";
import { useHistory } from "react-router-dom";
import { Button, EnumButtonStyle } from "../Components/Button";
import { EnumImages, SvgThemeImage } from "../Components/SvgThemeImage";
import { AppContext } from "../context/appContext";
import * as models from "../models";
import { formatError } from "../util/error";
import { validate } from "../util/formikValidateJsonSchema";
import { CROSS_OS_CTRL_ENTER } from "../util/hotkeys";
import useModuleDto from "./hooks/useModuleDto";
import { useModulesContext } from "../Modules/modulesContext";
import { REACT_APP_FEATURE_CUSTOM_ACTIONS_ENABLED } from "../env";

type Props = {
  resourceId: string;
  moduleId: string;
  onDtoCreated?: (moduleAction: models.ModuleDto) => void;
  buttonStyle?: EnumButtonStyle;
};

const FORM_SCHEMA = {
  required: ["displayName"],
  properties: {
    displayName: {
      type: "string",
      minLength: 2,
    },
  },
};

const INITIAL_VALUES: Partial<models.ModuleDto> = {
  name: "",
  displayName: "",
  description: "",
};

const keyMap = {
  SUBMIT: CROSS_OS_CTRL_ENTER,
};

const NewModuleDtoEnum = ({
  resourceId,
  moduleId,
  onDtoCreated,
  buttonStyle = EnumButtonStyle.Primary,
}: Props) => {
  const history = useHistory();
  const { currentWorkspace, currentProject } = useContext(AppContext);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const { customActionsLicenseEnabled } = useModulesContext();

  const {
    createModuleDtoEnum,
    createModuleDtoEnumData: data,
    createModuleDtoEnumError: error,
    createModuleDtoEnumLoading: loading,
  } = useModuleDto();

  const handleDialogStateChange = useCallback(() => {
    setDialogOpen(!dialogOpen);
  }, [dialogOpen, setDialogOpen]);

  const handleSubmit = useCallback(
    (data) => {
      const displayName = data.displayName.trim();
      const name = pascalCase(displayName);

      createModuleDtoEnum({
        variables: {
          data: {
            ...data,
            displayName,
            name,
            resource: { connect: { id: resourceId } },
            parentBlock: { connect: { id: moduleId } },
          },
        },
      })
        .catch(console.error)
        .then((result) => {
          if (result && result.data) {
            if (onDtoCreated && result && result.data) {
              onDtoCreated(result.data.createModuleDtoEnum);
            }
            history.push(
              `/${currentWorkspace?.id}/${currentProject?.id}/${resourceId}/modules/${moduleId}/dtos/${result.data.createModuleDtoEnum.id}`
            );
          }
        });
      setDialogOpen(false);
    },
    [
      createModuleDtoEnum,
      resourceId,
      moduleId,
      onDtoCreated,
      history,
      currentWorkspace?.id,
      currentProject?.id,
    ]
  );

  const errorMessage = formatError(error);

  return (
    <div>
      <Dialog
        isOpen={dialogOpen}
        onDismiss={handleDialogStateChange}
        title="New Dto"
      >
        <SvgThemeImage image={EnumImages.Entities} />
        <Text textAlign={EnumTextAlign.Center}>
          Give your new Enum a descriptive name. <br />
          For example: Get Customer, Find Orders, Create Ticket...
        </Text>

        <Formik
          initialValues={INITIAL_VALUES}
          validate={(values) => validate(values, FORM_SCHEMA)}
          onSubmit={handleSubmit}
          validateOnMount
        >
          {(formik) => {
            const handlers = {
              SUBMIT: formik.submitForm,
            };
            return (
              <Form>
                <GlobalHotKeys keyMap={keyMap} handlers={handlers} />
                <TextField
                  name="displayName"
                  label="New Enum Name"
                  disabled={loading}
                  autoFocus
                  hideLabel
                  placeholder="Type New Enum Name"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  buttonStyle={EnumButtonStyle.Primary}
                  disabled={!formik.isValid || loading}
                >
                  Create Enum
                </Button>
              </Form>
            );
          }}
        </Formik>
      </Dialog>
      {REACT_APP_FEATURE_CUSTOM_ACTIONS_ENABLED === "true" && (
        <Button
          buttonStyle={buttonStyle}
          onClick={handleDialogStateChange}
          disabled={!customActionsLicenseEnabled}
          icon="zap"
        >
          Add Enum
        </Button>
      )}
      <Snackbar open={Boolean(error)} message={errorMessage} />
    </div>
  );
};

export default NewModuleDtoEnum;
