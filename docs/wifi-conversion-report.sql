-- Custom 30-day conversion report, NOT billing-verified revenue.
-- Rollout-only schema v1; aggregate by opaque journey reference, not email.
-- Person identity is supplied by the existing website/product identification.
WITH wifi_events AS (
  SELECT properties.wifi_attribution_id AS ref,
    properties.wifi_event_id AS event_id, event, min(timestamp) AS at
  FROM events
  WHERE timestamp >= '2026-09-30 00:00:00' AND timestamp >= now() - INTERVAL 60 DAY
    AND timestamp <= now() AND properties.wifi_schema = 1 AND properties.wifi_source = 'wifi'
    AND event IN ('wifi_signup_completed', 'wifi_connected', 'wifi_pixii_open_requested')
    AND notEmpty(toString(properties.wifi_event_id))
  GROUP BY ref, event_id, event
), journeys AS (
  SELECT ref, minIf(at, event='wifi_signup_completed') AS joined_at,
    countIf(event='wifi_signup_completed') AS saved,
    countIf(event='wifi_connected') > 0 AS connected,
    countIf(event='wifi_pixii_open_requested') > 0 AS open_requested
  FROM wifi_events GROUP BY ref HAVING saved > 0
), arrivals AS (
  SELECT properties.wifi_attribution_id AS ref, argMin(person_id,timestamp) AS browser_person,
    min(timestamp) AS arrived_at, uniq(person_id) AS linked_people
  FROM events WHERE timestamp >= '2026-09-30 00:00:00' AND timestamp >= now() - INTERVAL 60 DAY
    AND timestamp <= now() AND event='wifi_website_arrived'
    AND properties.wifi_schema=1 AND properties.wifi_source='wifi'
  GROUP BY ref
), activity AS (
  SELECT person_id, groupArrayIf(timestamp,event='signup_completed') AS signups,
    groupArrayIf(timestamp,event='payment_made') AS payments,
    groupArrayIf(timestamp,event='$pageview') AS pageviews
  FROM events WHERE timestamp >= now() - INTERVAL 365 DAY AND timestamp <= now()
    AND event IN ('signup_completed','payment_made','$pageview')
    AND person_id IN (SELECT browser_person FROM arrivals WHERE linked_people=1)
  GROUP BY person_id
)
SELECT
  multiIf(a.linked_people=0 OR a.linked_people IS NULL, 'Unlinked',
    a.linked_people>1, 'Multiple browser identities - unresolved',
    arrayExists(t -> t < j.joined_at, coalesce(p.payments,[])), 'Known prior browser purchaser (365-day lookback)',
    arrayExists(t -> t >= a.arrived_at AND t <= j.joined_at + INTERVAL 30 DAY,coalesce(p.payments,[])), 'Newly observed browser purchaser',
    'Linked - no recorded purchase in window') AS journey_status,
  count() AS wifi_signups,
  countIf(j.connected) AS router_confirmed,
  countIf(j.open_requested) AS website_open_requested,
  countIf(a.linked_people=1) AS website_linked,
  countIf(a.linked_people=1 AND arrayExists(t -> t >= a.arrived_at AND t <= j.joined_at + INTERVAL 30 DAY,coalesce(p.pageviews,[]))) AS website_activity_30d,
  countIf(a.linked_people=1 AND arrayExists(t -> t >= a.arrived_at AND t <= j.joined_at + INTERVAL 30 DAY,coalesce(p.signups,[]))) AS product_signups_30d,
  countIf(a.linked_people=1 AND arrayExists(t -> t >= a.arrived_at AND t <= j.joined_at + INTERVAL 30 DAY,coalesce(p.payments,[]))) AS recorded_browser_purchasers_30d,
  countIf(j.joined_at + INTERVAL 30 DAY <= now()) AS completed_30_day_windows
FROM journeys j LEFT JOIN arrivals a ON j.ref=a.ref
LEFT JOIN activity p ON a.browser_person=p.person_id
GROUP BY journey_status ORDER BY wifi_signups DESC
