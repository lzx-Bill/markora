import { openApiDocument } from "@markora/contracts";
import { Controller, Get, Header } from "@nestjs/common";
import { PublicRoute } from "./auth/public.decorator.js";

@Controller()
@PublicRoute()
export class OpenApiController {
  @Get("openapi.json")
  @Header("cache-control", "no-store")
  public getOpenApi(): typeof openApiDocument {
    return openApiDocument;
  }
}
