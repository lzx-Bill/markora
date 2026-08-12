import { loadServerConfig } from "@markora/config";
import { Injectable } from "@nestjs/common";
import { argon2id, type HashOptions, hash, verify } from "argon2";

@Injectable()
export class PasswordService {
  private readonly options: HashOptions;

  public constructor() {
    const config = loadServerConfig(process.env);
    this.options = {
      type: argon2id,
      memoryCost: config.ARGON2_MEMORY_KIB,
      timeCost: config.ARGON2_TIME_COST,
      parallelism: config.ARGON2_PARALLELISM,
    };
  }

  public hash(password: string): Promise<string> {
    return hash(password, { ...this.options, raw: false });
  }

  public async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
