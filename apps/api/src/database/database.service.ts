import { loadServerConfig } from "@markora/config";
import { createDatabaseClient, type DatabaseClient } from "@markora/database";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  public readonly client: DatabaseClient;

  public constructor() {
    const config = loadServerConfig(process.env);
    this.client = createDatabaseClient(config.DATABASE_URL);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
