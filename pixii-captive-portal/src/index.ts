import { routeRequest } from "./http";
import type { Env, HandlerContext, ScheduledControllerLike } from "./types";
import { runScheduled } from "./scheduled";

export default {
  fetch(request: Request, env: Env, ctx: HandlerContext): Promise<Response> {
    return routeRequest(request, env, ctx);
  },

  scheduled(
    controller: ScheduledControllerLike,
    env: Env,
    ctx: HandlerContext
  ): void {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  }
};
