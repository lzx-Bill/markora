import {
  QuickOpenQuerySchema,
  type QuickOpenResult,
  SearchQuerySchema,
  type SearchResultPage,
} from "@markora/contracts";
import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { SearchService } from "./search.service.js";

@Controller()
export class SearchController {
  @Inject(SearchService)
  private readonly searchService!: SearchService;

  @Get("search")
  public search(
    @Query() query: unknown,
    @Req() request: RequestContext,
  ): Promise<SearchResultPage> {
    return this.searchService.search(request.principal, parseRequest(SearchQuerySchema, query));
  }

  @Get("quick-open")
  public quickOpen(
    @Query() query: unknown,
    @Req() request: RequestContext,
  ): Promise<QuickOpenResult> {
    return this.searchService.quickOpen(
      request.principal,
      parseRequest(QuickOpenQuerySchema, query),
    );
  }
}
