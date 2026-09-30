export type AuthorizationStatus = "pending" | "acknowledged" | "expired" | "failed";
export type QueueState = "pending" | "delivered" | "acknowledged" | "expired";
export type SubmissionSource = "wifi" | "team_test" | "public_web";

export interface RegistrationInsert {
  id: string;
  eventId: string;
  routerId: string;
  fullName: string;
  email: string;
  emailNormalized: string;
  phoneCountry: string;
  phoneE164: string;
  consentEmailMarketing: true;
  consentVersion: string;
  consentText: string;
  consentedAt: string;
  createdAt: string;
  authorizationStatus: AuthorizationStatus;
  formIdempotencyKey: string;
  submissionSource: SubmissionSource;
  requiresAdGate?: boolean;
  analyticsVisitId?: string | null;
}

export interface AdGateRow {
  ad_gate_required: number;
  ad_started_at: number | null;
  ad_visible_ms: number;
  ad_completed_at: number | null;
}

export interface RegistrationAdminRow {
  id: string;
  fullName: string;
  email: string;
  phoneCountry: string;
  phoneE164: string;
  consentedAt: string;
  createdAt: string;
  authorizationStatus: AuthorizationStatus;
  submissionSource: SubmissionSource;
}

interface RegistrationAdminDatabaseRow {
  id: string;
  full_name: string;
  email: string;
  phone_country: string;
  phone_e164: string;
  consented_at: string;
  created_at: string;
  authorization_status: AuthorizationStatus;
  submission_source: SubmissionSource;
}

export interface AuthorizationInsert {
  rhid: string;
  registrationId: string;
  gatewayHash: string;
  authRecord: string;
  state: QueueState;
  createdAt: string;
  expiresAt: string;
  availableAt?: string;
}

export interface RegistrationCreateResult {
  id: string;
  created: boolean;
}

export interface RouterRow {
  id: string;
  eventId: string;
  profileId: string;
  gatewayName: string;
  gatewayHash: string;
  enabled: boolean;
}

interface RouterDatabaseRow {
  id: string;
  event_id: string;
  profile_id: string;
  gateway_name: string;
  gateway_hash: string;
  enabled: number;
}

export interface BootstrapExchangeInput {
  tokenHash: string;
  profileId: string;
  now: string;
  retryWindowStart: string;
}

export interface BootstrapCandidate {
  expiresAt: string;
  router: RouterRow;
}

export type BootstrapExchangeResult =
  | {
      status: "ok";
      exchangeCount: 1 | 2;
      expiresAt: string;
      router: RouterRow;
    }
  | {
      status:
        | "not_found"
        | "profile_mismatch"
        | "expired"
        | "disabled"
        | "exhausted"
        | "invalid_response";
    };

interface BootstrapDatabaseRow extends RouterDatabaseRow {
  token_profile_id: string;
  expires_at: string;
  exchange_count: number;
  first_exchanged_at: string | null;
}

export interface AuthmonPollInput {
  gatewayHash: string;
  mode: "view" | "list";
  acknowledgedRhids: readonly string[];
  now: string;
  limit: number;
}

export interface AuthmonRecord {
  rhid: string;
  authRecord: string;
}

export interface AuthmonPollResult {
  records: AuthmonRecord[];
}

interface AuthQueueDatabaseRow {
  rhid: string;
  auth_record: string;
}

export class D1Repository {
  constructor(private readonly db: D1Database) {}

  async findRouterByGatewayName(gatewayName: string): Promise<RouterRow | null> {
    const row = await this.db.prepare(
      `SELECT id, event_id, profile_id, gateway_name, gateway_hash, enabled
       FROM routers WHERE gateway_name = ?`
    ).bind(gatewayName).first<RouterDatabaseRow>();
    return row ? mapRouter(row) : null;
  }

  async findRouterByGatewayHash(gatewayHash: string): Promise<RouterRow | null> {
    if (/^[a-f0-9]{32}$/u.test(gatewayHash)) {
      // Compatibility for the reported vendor/local short-ID variant, not an
      // upstream-wide change to SHA-256. Count disabled matches too: ambiguous
      // prefixes must fail closed instead of silently choosing a router.
      const matches = await this.db.prepare(
        `SELECT id, event_id, profile_id, gateway_name, gateway_hash, enabled
         FROM routers WHERE substr(gateway_hash, 1, 32) = ? LIMIT 2`
      ).bind(gatewayHash).all<RouterDatabaseRow>();
      const row = matches.results.length === 1 ? matches.results[0] : undefined;
      return row ? mapRouter(row) : null;
    }
    if (!/^[a-f0-9]{64}$/u.test(gatewayHash)) return null;
    const row = await this.db.prepare(
      `SELECT id, event_id, profile_id, gateway_name, gateway_hash, enabled
       FROM routers WHERE gateway_hash = ?`
    ).bind(gatewayHash).first<RouterDatabaseRow>();
    return row ? mapRouter(row) : null;
  }

  async findRouterById(id: string): Promise<RouterRow | null> {
    const row = await this.db.prepare(
      `SELECT id, event_id, profile_id, gateway_name, gateway_hash, enabled
       FROM routers WHERE id = ?`
    ).bind(id).first<RouterDatabaseRow>();
    return row ? mapRouter(row) : null;
  }

  async readAuthorizationStatus(
    registrationId: string,
    now = new Date().toISOString()
  ): Promise<AuthorizationStatus | null> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE auth_queue SET state = 'expired'
         WHERE registration_id = ? AND state IN ('pending', 'delivered') AND expires_at <= ?`
      ).bind(registrationId, now),
      this.db.prepare(
        `UPDATE registrations SET authorization_status = 'expired'
         WHERE id = ? AND authorization_status = 'pending'
           AND EXISTS (
             SELECT 1 FROM auth_queue
             WHERE registration_id = ? AND state = 'expired' AND expires_at <= ?
           )`
      ).bind(registrationId, registrationId, now)
    ]);
    const row = await this.db.prepare(
      "SELECT authorization_status, ad_gate_required, ad_completed_at FROM registrations WHERE id = ?"
    ).bind(registrationId).first<{ authorization_status: AuthorizationStatus; ad_gate_required: number; ad_completed_at: number | null }>();
    if (!row) return null;
    if (row.authorization_status === "acknowledged" && row.ad_gate_required === 1 && row.ad_completed_at === null) return "pending";
    return row.authorization_status;
  }

  async readAdGate(registrationId: string): Promise<AdGateRow | null> {
    return this.db.prepare("SELECT ad_gate_required, ad_started_at, ad_visible_ms, ad_completed_at FROM registrations WHERE id = ?")
      .bind(registrationId).first<AdGateRow>();
  }

  async startAd(registrationId: string, nowMs: number, visibleMs: number): Promise<AdGateRow | null> {
    // Repeated calls checkpoint visible time. Neither retries nor refresh reset the start.
    await this.db.prepare(`UPDATE registrations SET
      ad_visible_ms = MAX(ad_visible_ms, MIN(?, MAX(0, ? - COALESCE(ad_started_at, ?)))),
      ad_started_at = COALESCE(ad_started_at, ?)
      WHERE id = ? AND ad_gate_required = 1 AND ad_completed_at IS NULL
        AND authorization_status IN ('pending', 'acknowledged')`)
      .bind(visibleMs, nowMs, nowMs, nowMs, registrationId).run();
    return this.readAdGate(registrationId);
  }

  async completeAd(registrationId: string, nowMs: number, visibleMs: number): Promise<AdGateRow | null> {
    const now = new Date(nowMs).toISOString();
    await this.db.batch([
      this.db.prepare(`UPDATE registrations SET ad_completed_at = ?, ad_visible_ms = 7000
        WHERE id = ? AND ad_gate_required = 1 AND ad_completed_at IS NULL
          AND ad_started_at IS NOT NULL AND ? - ad_started_at >= 7000 AND ? >= 7000
          AND authorization_status IN ('pending', 'acknowledged')
          AND NOT EXISTS (SELECT 1 FROM auth_queue WHERE registration_id = registrations.id
            AND (expires_at <= ? OR state = 'expired'))`)
        .bind(nowMs, registrationId, nowMs, visibleMs, now),
      this.db.prepare(`UPDATE auth_queue SET available_at = ?
        WHERE registration_id = ? AND state IN ('pending', 'delivered') AND expires_at > ?
          AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = auth_queue.registration_id
            AND r.ad_completed_at IS NOT NULL)`)
        .bind(now, registrationId, now)
    ]);
    return this.readAdGate(registrationId);
  }

  async exchangeBootstrapToken(
    input: BootstrapExchangeInput,
    validateCandidate: (candidate: BootstrapCandidate) => boolean = () => true
  ): Promise<BootstrapExchangeResult> {
    const read = (): Promise<BootstrapDatabaseRow | null> => this.db.prepare(
      `SELECT
        r.id, r.event_id, r.profile_id, r.gateway_name, r.gateway_hash, r.enabled,
        bt.profile_id AS token_profile_id, bt.expires_at, bt.exchange_count,
        bt.first_exchanged_at
       FROM bootstrap_tokens bt
       JOIN routers r ON r.id = bt.router_id
       WHERE bt.token_hash = ?`
    ).bind(input.tokenHash).first<BootstrapDatabaseRow>();

    let row = await read();
    if (!row) return { status: "not_found" };
    if (row.token_profile_id !== input.profileId || row.profile_id !== input.profileId) {
      return { status: "profile_mismatch" };
    }
    if (row.enabled !== 1) return { status: "disabled" };
    if (row.expires_at <= input.now) return { status: "expired" };
    if (!validateCandidate({ expiresAt: row.expires_at, router: mapRouter(row) })) {
      return { status: "invalid_response" };
    }

    if (row.exchange_count === 0) {
      const result = await this.db.prepare(
        `UPDATE bootstrap_tokens
         SET exchange_count = 1, first_exchanged_at = ?, last_exchanged_at = ?
         WHERE token_hash = ? AND exchange_count = 0`
      ).bind(input.now, input.now, input.tokenHash).run();
      if (result.meta.changes === 1) {
        return {
          status: "ok",
          exchangeCount: 1,
          expiresAt: row.expires_at,
          router: mapRouter(row)
        };
      }
      row = await read();
      if (!row) return { status: "not_found" };
      if (row.token_profile_id !== input.profileId || row.profile_id !== input.profileId) {
        return { status: "profile_mismatch" };
      }
      if (row.enabled !== 1) return { status: "disabled" };
      if (row.expires_at <= input.now) return { status: "expired" };
      if (!validateCandidate({ expiresAt: row.expires_at, router: mapRouter(row) })) {
        return { status: "invalid_response" };
      }
    }

    if (
      row.exchange_count === 1 &&
      row.first_exchanged_at !== null &&
      row.first_exchanged_at >= input.retryWindowStart
    ) {
      const result = await this.db.prepare(
        `UPDATE bootstrap_tokens
         SET exchange_count = 2, last_exchanged_at = ?
         WHERE token_hash = ? AND exchange_count = 1 AND first_exchanged_at >= ?`
      ).bind(input.now, input.tokenHash, input.retryWindowStart).run();
      if (result.meta.changes === 1) {
        return {
          status: "ok",
          exchangeCount: 2,
          expiresAt: row.expires_at,
          router: mapRouter(row)
        };
      }
    }

    return { status: "exhausted" };
  }

  async authmonPoll(input: AuthmonPollInput): Promise<AuthmonPollResult> {
    await this.expireGatewayAuthorizations(input.gatewayHash, input.now);
    const acknowledgements = [...new Set(input.acknowledgedRhids)];
    if (acknowledgements.length > 0) {
      const statements: D1PreparedStatement[] = [];
      for (const rhid of acknowledgements) {
        statements.push(
          this.db.prepare(
            `UPDATE auth_queue
             SET state = 'acknowledged', acknowledged_at = ?, analytics_ack_at = ?
             WHERE rhid = ? AND gateway_hash = ? AND state IN ('pending', 'delivered')
               AND expires_at > ? AND COALESCE(available_at, created_at) <= ?
               AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = auth_queue.registration_id
                 AND (r.ad_gate_required = 0 OR r.ad_completed_at IS NOT NULL))`
          ).bind(input.now, input.now, rhid, input.gatewayHash, input.now, input.now),
          this.db.prepare(
            `UPDATE registrations SET authorization_status = 'acknowledged'
             WHERE id = (
               SELECT registration_id FROM auth_queue
               WHERE rhid = ? AND gateway_hash = ? AND state = 'acknowledged'
             ) AND authorization_status IN ('pending', 'acknowledged')`
          ).bind(rhid, input.gatewayHash)
        );
      }
      await this.db.batch(statements);
    }

    const selected = await this.db.prepare(
      `SELECT rhid, auth_record FROM auth_queue
       WHERE gateway_hash = ?
         AND state IN ('pending', 'delivered')
         AND expires_at > ?
         AND COALESCE(available_at, created_at) <= ?
         AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = auth_queue.registration_id
           AND (r.ad_gate_required = 0 OR r.ad_completed_at IS NOT NULL))
       ORDER BY created_at, rhid
       LIMIT ?`
    ).bind(input.gatewayHash, input.now, input.now, input.limit).all<AuthQueueDatabaseRow>();
    const rows = selected.results;

    if (rows.length > 0) {
      const updates: D1PreparedStatement[] = [];
      for (const row of rows) {
        if (input.mode === "list") {
          updates.push(
            this.db.prepare(
              `UPDATE auth_queue
               SET state = 'acknowledged', acknowledged_at = ?, delivery_count = delivery_count + 1
               WHERE rhid = ? AND gateway_hash = ? AND state IN ('pending', 'delivered')
                 AND expires_at > ?`
            ).bind(input.now, row.rhid, input.gatewayHash, input.now),
            this.db.prepare(
              `UPDATE registrations SET authorization_status = 'acknowledged'
               WHERE id = (
                 SELECT registration_id FROM auth_queue
                 WHERE rhid = ? AND gateway_hash = ? AND state = 'acknowledged'
               )`
            ).bind(row.rhid, input.gatewayHash)
          );
        } else {
          updates.push(
            this.db.prepare(
              `UPDATE auth_queue
               SET state = 'delivered', delivery_count = delivery_count + 1
               WHERE rhid = ? AND gateway_hash = ? AND state IN ('pending', 'delivered')
                 AND expires_at > ?`
            ).bind(row.rhid, input.gatewayHash, input.now)
          );
        }
      }
      const updateResults = await this.db.batch(updates);
      if (input.mode === "list") {
        return {
          records: rows.filter((_row, index) => updateResults[index * 2]?.meta.changes === 1)
            .map((row) => ({ rhid: row.rhid, authRecord: row.auth_record }))
        };
      }
    }

    return {
      records: rows.map((row) => ({ rhid: row.rhid, authRecord: row.auth_record }))
    };
  }

  async clearGatewayAuthorizations(gatewayHash: string): Promise<number> {
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE auth_queue SET state = 'expired'
         WHERE gateway_hash = ? AND state IN ('pending', 'delivered')`
      ).bind(gatewayHash),
      this.db.prepare(
        `UPDATE registrations SET authorization_status = 'expired'
         WHERE id IN (
           SELECT registration_id FROM auth_queue
           WHERE gateway_hash = ? AND state = 'expired'
         ) AND authorization_status = 'pending'`
      ).bind(gatewayHash)
    ]);
    return results[0]?.meta.changes ?? 0;
  }

  private async expireGatewayAuthorizations(gatewayHash: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE auth_queue SET state = 'expired'
         WHERE gateway_hash = ? AND state IN ('pending', 'delivered') AND expires_at <= ?`
      ).bind(gatewayHash, now),
      this.db.prepare(
        `UPDATE registrations SET authorization_status = 'expired'
         WHERE id IN (
           SELECT registration_id FROM auth_queue
           WHERE gateway_hash = ? AND state = 'expired'
         ) AND authorization_status = 'pending'`
      ).bind(gatewayHash)
    ]);
  }

  async expireOperationalRows(
    now: string,
    deleteBefore: string,
    limit: number
  ): Promise<{ expired: number; deleted: number }> {
    const expired = await this.db.prepare(
      `UPDATE auth_queue SET state = 'expired'
       WHERE rhid IN (
         SELECT rhid FROM auth_queue
         WHERE state IN ('pending', 'delivered') AND expires_at <= ?
         ORDER BY expires_at LIMIT ?
       )`
    ).bind(now, limit).run();
    await this.db.prepare(
      `UPDATE registrations SET authorization_status = 'expired'
       WHERE id IN (
         SELECT registration_id FROM auth_queue
         WHERE state = 'expired' AND expires_at <= ?
       ) AND authorization_status = 'pending'`
    ).bind(now).run();
    const deleted = await this.db.prepare(
      `DELETE FROM auth_queue WHERE rhid IN (
         SELECT rhid FROM auth_queue
         WHERE state IN ('acknowledged', 'expired') AND created_at <= ?
         ORDER BY created_at LIMIT ?
       )`
    ).bind(deleteBefore, limit).run();
    return { expired: expired.meta.changes, deleted: deleted.meta.changes };
  }

  async deleteExpiredRegistrations(now: string, limit: number): Promise<number> {
    const result = await this.db.prepare(
      `DELETE FROM registrations WHERE id IN (
         SELECT r.id FROM registrations r
         JOIN events e ON e.id = r.event_id
         WHERE datetime(r.created_at, '+' || e.retention_days || ' days') <= datetime(?)
         ORDER BY r.created_at LIMIT ?
       )`
    ).bind(now, limit).run();
    return result.meta.changes;
  }

  async createRegistrationAndAuthorization(
    registration: RegistrationInsert,
    authorization: AuthorizationInsert
  ): Promise<RegistrationCreateResult> {
    const existing = await this.findRegistrationByIdempotencyKey(
      registration.formIdempotencyKey
    );
    if (existing) {
      return { id: existing.id, created: false };
    }

    const registrationStatement = this.db.prepare(
      `INSERT INTO registrations (
        id, event_id, router_id, full_name, email, email_normalized, phone_country, phone_e164,
        consent_email_marketing, consent_version, consent_text, consented_at,
        created_at, authorization_status, form_idempotency_key, submission_source, ad_gate_required, analytics_visit_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      registration.id,
      registration.eventId,
      registration.routerId,
      registration.fullName,
      registration.email,
      registration.emailNormalized,
      registration.phoneCountry,
      registration.phoneE164,
      registration.consentEmailMarketing ? 1 : 0,
      registration.consentVersion,
      registration.consentText,
      registration.consentedAt,
      registration.createdAt,
      registration.authorizationStatus,
      registration.formIdempotencyKey,
      registration.submissionSource,
      registration.requiresAdGate ? 1 : 0,
      registration.analyticsVisitId ?? null
    );

    const authorizationStatement = this.db.prepare(
      `INSERT INTO auth_queue (
        rhid, registration_id, gateway_hash, auth_record, state,
        delivery_count, created_at, expires_at, acknowledged_at, available_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`
    ).bind(
      authorization.rhid,
      authorization.registrationId,
      authorization.gatewayHash,
      authorization.authRecord,
      authorization.state,
      authorization.createdAt,
      authorization.expiresAt,
      authorization.availableAt ?? authorization.createdAt
    );

    try {
      await this.db.batch([registrationStatement, authorizationStatement]);
      return { id: registration.id, created: true };
    } catch (error) {
      const raced = await this.findRegistrationByIdempotencyKey(
        registration.formIdempotencyKey
      );
      if (raced) {
        return { id: raced.id, created: false };
      }
      throw error;
    }
  }

  async createStandaloneRegistration(registration: RegistrationInsert): Promise<void> {
    await this.db.prepare(
      `INSERT INTO registrations (
        id, event_id, router_id, full_name, email, email_normalized, phone_country, phone_e164,
        consent_email_marketing, consent_version, consent_text, consented_at,
        created_at, authorization_status, form_idempotency_key, submission_source, ad_gate_required, analytics_visit_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      registration.id,
      registration.eventId,
      registration.routerId,
      registration.fullName,
      registration.email,
      registration.emailNormalized,
      registration.phoneCountry,
      registration.phoneE164,
      registration.consentEmailMarketing ? 1 : 0,
      registration.consentVersion,
      registration.consentText,
      registration.consentedAt,
      registration.createdAt,
      registration.authorizationStatus,
      registration.formIdempotencyKey,
      registration.submissionSource,
      registration.requiresAdGate ? 1 : 0,
      registration.analyticsVisitId ?? null
    ).run();
  }

  async listRegistrationsForAdmin(limit = 100): Promise<RegistrationAdminRow[]> {
    const result = await this.db.prepare(
      `SELECT id, full_name, email, phone_country, phone_e164, consented_at, created_at,
              authorization_status, submission_source
       FROM registrations
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(Math.min(Math.max(limit, 1), 500)).all<RegistrationAdminDatabaseRow>();
    return result.results.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phoneCountry: row.phone_country,
      phoneE164: row.phone_e164,
      consentedAt: row.consented_at,
      createdAt: row.created_at,
      authorizationStatus: row.authorization_status,
      submissionSource: row.submission_source
    }));
  }

  private findRegistrationByIdempotencyKey(
    formIdempotencyKey: string
  ): Promise<{ id: string } | null> {
    return this.db.prepare(
      "SELECT id FROM registrations WHERE form_idempotency_key = ?"
    ).bind(formIdempotencyKey).first<{ id: string }>();
  }
}

function mapRouter(row: RouterDatabaseRow): RouterRow {
  return {
    id: row.id,
    eventId: row.event_id,
    profileId: row.profile_id,
    gatewayName: row.gateway_name,
    gatewayHash: row.gateway_hash,
    enabled: row.enabled === 1
  };
}
