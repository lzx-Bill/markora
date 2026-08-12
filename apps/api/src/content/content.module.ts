import { Module } from "@nestjs/common";
import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";
import { DocumentsController } from "./documents.controller.js";
import { FoldersController } from "./folders.controller.js";
import { WorkspaceController } from "./workspace.controller.js";

@Module({
  controllers: [WorkspaceController, FoldersController, DocumentsController],
  providers: [ContentRepository, ContentService],
})
export class ContentModule {}
