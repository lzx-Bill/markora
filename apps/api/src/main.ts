import "reflect-metadata";
import { loadServerConfig } from "@markora/config";
import { Logger } from "@nestjs/common";
import { createApplication } from "./create-app.js";

const config = loadServerConfig(process.env);
const app = await createApplication();
await app.listen(config.API_PORT, config.API_HOST);

Logger.log(`API listening on ${config.API_HOST}:${config.API_PORT}`, "Bootstrap");
