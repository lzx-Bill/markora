import { Module } from "@nestjs/common";
import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";
import { DocumentsController } from "./documents.controller.js";
import { FoldersController } from "./folders.controller.js";
import { JobsController } from "./jobs.controller.js";
import { TrashController } from "./trash.controller.js";
import { TrashService } from "./trash.service.js";
import { VersionService } from "./version.service.js";
import { VersionsController } from "./versions.controller.js";
import { WorkspaceController } from "./workspace.controller.js";

@Module({
  controllers: [
    WorkspaceController,
    FoldersController,
    DocumentsController,
    VersionsController,
    TrashController,
    JobsController,
  ],
  providers: [ContentRepository, ContentService, VersionService, TrashService],
  exports: [ContentRepository, VersionService],
})
export class ContentModule {}
