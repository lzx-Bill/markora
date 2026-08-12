import type { ErrorCode } from "@markora/contracts";
import { HttpException } from "@nestjs/common";

export class CodedHttpException extends HttpException {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}
