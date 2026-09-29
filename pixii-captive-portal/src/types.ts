export interface Env extends Pick<Cloudflare.Env, "DB" | "ASSETS"> {
  FAS_KEY: string;
  FORM_SIGNING_KEY: string;
  BOOTSTRAP_HMAC_KEY: string;
  PREVIEW_TEST_PASSWORD: string;
  ENVIRONMENT: "test" | "production";
}

export interface HandlerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  readonly scheduledTime: number;
  readonly cron: string;
}
