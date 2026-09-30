export interface Env extends Pick<Cloudflare.Env, "DB" | "ASSETS"> {
  FAS_KEY: string;
  FORM_SIGNING_KEY: string;
  BOOTSTRAP_HMAC_KEY: string;
  PREVIEW_TEST_PASSWORD: string;
  ENVIRONMENT: "test" | "production";
  ANALYTICS_ENABLED?: string;
  ANALYTICS_ROLLOUT_AT?: string;
  POSTHOG_PROJECT_TOKEN?: string;
  PRIVACY_US_REVIEWED?: string;
  PIXELS_ENABLED?: string;
  META_ENABLED?: string;
  GOOGLE_ENABLED?: string;
  LINKEDIN_ENABLED?: string;
  RB2B_ENABLED?: string;
  LINKEDIN_PARTNER_ID?: string;
  RB2B_DOMAIN_VERIFIED?: string;
  ANALYTICS_LIMIT?: RateLimit;
}

export interface HandlerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  readonly scheduledTime: number;
  readonly cron: string;
}
