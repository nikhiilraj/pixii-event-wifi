import { routeRequest } from "./http";
import type { Env, HandlerContext, ScheduledControllerLike } from "./types";
import { runScheduled } from "./scheduled";
import { backgroundAnalytics } from "./analytics";

export default {
  fetch(request: Request, env: Env, ctx: HandlerContext): Promise<Response> {
    return routeRequest(request, env, ctx);
  },

  scheduled(
    controller: ScheduledControllerLike,
    env: Env,
    ctx: HandlerContext
  ): void {
    if (controller.cron === "*/5 * * * *") backgroundAnalytics(env, ctx);
    else ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  }
};
