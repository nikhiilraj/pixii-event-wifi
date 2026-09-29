# Monte: making changes to the Wi-Fi pages

You need **two separate permissions**: collaborator access to this private GitHub repo, and permission to edit/deploy Workers in the existing Cloudflare account. Cloudflare access does not automatically grant GitHub access.

1. Accept the GitHub invitation, clone/download this repository, and open the whole folder in Codex.
2. Tell Codex the exact text or design change you want. Use the prompt below.
3. Review its local preview. Once happy, ask it to publish to the existing Worker.
4. Check https://wifi.pixii.ai/preview/connecting. No router reinstall is needed for page changes.

## Prompt to paste into Codex

> Read README.md and AGENTS.md in this repository. Help me make this change: [describe the change]. First confirm the correct files and current deployed Worker. Use local fixtures to preview and test; do not request or print production secrets, export leads, alter router configuration, run remote database writes, or change DNS. Preserve the seven-second ad gate and router compatibility. Show me the preview, then wait for my approval before publishing. After approval, deploy to the existing pixii-event-wifi Worker with existing bindings and secrets preserved, verify the page at wifi.pixii.ai, and push the source changes to a branch with a pull request. Keep GitHub and the live deployment in sync, and tell me if a native-device check is still needed.

The only browser login you may need to perform yourself is Cloudflare/GitHub sign-in. Do not paste passwords or API keys into the chat.

## Preview versus real Wi-Fi

- `/preview`: form design; no submission.
- `/preview/connecting`: looping ad preview; no Wi-Fi authorization.
- `/preview/connected`: final page; automatically redirects after five visible seconds.
- `/preview/test`: saves a test registration in **production**; use only deliberately, with obvious test details.
- A real Wi-Fi test must start by joining `unBoxed2026 - Fast` on the actual router, with cellular data off. Visiting the bare website is not a router test.

For lead access, use the existing protected backend or Cloudflare D1 with authorized access. Do not put customer data into GitHub.
