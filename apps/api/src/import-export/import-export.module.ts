import { Module } from "@nestjs/common";
import { ExportService } from "./export.service.js";
import { ExportsController } from "./exports.controller.js";
import { ImportService } from "./import.service.js";
import { ImportsController } from "./imports.controller.js";

@Module({
  controllers: [ImportsController, ExportsController],
  providers: [ImportService, ExportService],
})
export class ImportExportModule {}
