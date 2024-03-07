import { Injectable } from "@nestjs/common";
import { UserEntity } from "../../decorators/user.decorator";
import { EnumBlockType } from "../../enums/EnumBlockType";
import { AmplicationError } from "../../errors/AmplicationError";
import { Entity, User } from "../../models";
import { BlockService } from "../block/block.service";
import { BlockTypeService } from "../block/blockType.service";
import { ModuleActionService } from "../moduleAction/moduleAction.service";
import { ModuleDtoService } from "../moduleDto/moduleDto.service";
import { DefaultModuleForEntityNotFoundError } from "./DefaultModuleForEntityNotFoundError";
import { CreateModuleArgs } from "./dto/CreateModuleArgs";
import { DeleteModuleArgs } from "./dto/DeleteModuleArgs";
import { FindManyModuleArgs } from "./dto/FindManyModuleArgs";
import { Module } from "./dto/Module";
import { ModuleUpdateInput } from "./dto/ModuleUpdateInput";
import { UpdateModuleArgs } from "./dto/UpdateModuleArgs";
import { ConfigService } from "@nestjs/config";
import { Env } from "../../env";
const DEFAULT_MODULE_DESCRIPTION =
  "This module was automatically created as the default module for an entity";

@Injectable()
export class ModuleService extends BlockTypeService<
  Module,
  FindManyModuleArgs,
  CreateModuleArgs,
  UpdateModuleArgs,
  DeleteModuleArgs
> {
  blockType = EnumBlockType.Module;

  customActionsEnabled: boolean;

  constructor(
    protected readonly blockService: BlockService,
    private readonly moduleActionService: ModuleActionService,
    private readonly moduleDtoService: ModuleDtoService,
    private configService: ConfigService
  ) {
    super(blockService);

    this.customActionsEnabled = Boolean(
      this.configService.get<string>(Env.FEATURE_CUSTOM_ACTIONS_ENABLED) ===
        "true"
    );
  }

  validateModuleName(moduleName: string): void {
    const regex = /^[a-zA-Z0-9._-]{1,249}$/;
    if (!regex.test(moduleName)) {
      throw new AmplicationError(`Invalid module name: ${moduleName}`);
    }
  }

  async create(args: CreateModuleArgs, user: User): Promise<Module> {
    if (!args.data.entityId && !this.customActionsEnabled) {
      return null;
    }

    this.validateModuleName(args.data.name);

    return super.create(
      {
        ...args,
        data: {
          ...args.data,
          displayName: args.data.name,
          enabled: true,
        },
      },
      user
    );
  }

  async update(args: UpdateModuleArgs, user: User): Promise<Module> {
    const existingModule = await super.findOne({
      where: {
        id: args.where.id,
      },
    });

    if (existingModule?.entityId) {
      if (
        existingModule.name !== args.data.name &&
        args.data.name !== undefined
      ) {
        throw new AmplicationError(
          "Cannot update the name of a default Module for entity."
        );
      }
    }

    this.validateModuleName(args.data.name);
    return super.update(
      {
        ...args,
        data: {
          ...args.data,
          displayName: args.data.name,
        },
      },
      user
    );
  }

  async delete(
    args: DeleteModuleArgs,
    @UserEntity() user: User
  ): Promise<Module> {
    const module = await super.findOne(args);

    if (module?.entityId) {
      throw new AmplicationError(
        "Cannot delete the default module for entity. To delete it, you must delete the entity"
      );
    }
    return super.delete(args, user, true, true);
  }

  async createDefaultModuleForEntity(
    args: CreateModuleArgs,
    entity: Entity,
    user: User
  ): Promise<Module> {
    const module = await this.create(
      {
        ...args,
        data: {
          ...args.data,
          description: DEFAULT_MODULE_DESCRIPTION,
          entityId: entity.id,
        },
      },
      user
    );

    await this.moduleActionService.createDefaultActionsForEntityModule(
      entity,
      module,
      user
    );

    await this.moduleDtoService.createDefaultDtosForEntityModule(
      entity,
      module,
      user
    );

    return module;
  }

  async getDefaultModuleIdForEntity(
    resourceId: string,
    entityId: string
  ): Promise<string> {
    const [module] = await this.findManyBySettings(
      {
        where: {
          resource: {
            id: resourceId,
          },
        },
      },
      {
        path: ["entityId"],
        equals: entityId,
      }
    );

    if (!module) {
      throw new DefaultModuleForEntityNotFoundError(entityId);
    }

    return module.id;
  }

  async updateDefaultModuleForEntity(
    args: ModuleUpdateInput,
    entity: Entity,
    user: User
  ): Promise<Module> {
    const moduleId = await this.getDefaultModuleIdForEntity(
      entity.resourceId,
      entity.id
    );

    const module = await super.update(
      {
        where: {
          id: moduleId,
        },
        data: args,
      },
      user
    );

    await this.moduleActionService.updateDefaultActionsForEntityModule(
      entity,
      module,
      user
    );

    await this.moduleDtoService.updateDefaultDtosForEntityModule(
      entity,
      module,
      user
    );

    return module;
  }

  async deleteDefaultModuleForEntity(
    resourceId: string,
    entityId: string,
    user: User
  ): Promise<Module> {
    const moduleId = await this.getDefaultModuleIdForEntity(
      resourceId,
      entityId
    );

    return super.delete({ where: { id: moduleId } }, user, true); //delete the module and all its children (actions/type...)
  }
}
