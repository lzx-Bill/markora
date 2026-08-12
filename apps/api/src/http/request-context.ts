import type { Principal } from "@markora/contracts";
import type { Request } from "express";

export interface RequestContext extends Request {
  requestId: string;
  principal: Principal;
}
