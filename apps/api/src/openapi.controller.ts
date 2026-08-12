import { openApiDocument } from "@markora/contracts";
import { Controller, Get, Header } from "@nestjs/common";

@Controller()
export class OpenApiController {
  @Get("openapi.json")
  @Header("cache-control", "no-store")
  public getOpenApi(): typeof openApiDocument {
    return openApiDocument;
  }
}
