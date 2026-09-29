# Pixii Wi-Fi Pages gateway

This Cloudflare Pages project exposes the captive portal at `wifi.pixii.ai`
without moving the `pixii.ai` DNS zone to Cloudflare. It forwards requests to
the existing `pixii-event-wifi` Worker through a private Cloudflare service
binding, so the portal and D1 database remain unchanged.

The Route 53 DNS record is:

- Name: `wifi`
- Type: `CNAME`
- Value: `pixii-wifi-gateway.pages.dev`
- TTL: `300`

Do not add the DNS record until the custom domain has been attached to this
Pages project.
