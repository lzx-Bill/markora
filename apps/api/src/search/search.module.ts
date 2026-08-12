import { Module } from "@nestjs/common";
import { ContentModule } from "../content/content.module.js";
import { PostgresSearchProvider } from "./postgres-search.provider.js";
import { SearchController } from "./search.controller.js";
import { SEARCH_PROVIDER } from "./search.provider.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [ContentModule],
  controllers: [SearchController],
  providers: [
    PostgresSearchProvider,
    SearchService,
    { provide: SEARCH_PROVIDER, useExisting: PostgresSearchProvider },
  ],
})
export class SearchModule {}
