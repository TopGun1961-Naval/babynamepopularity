# Baby Page emails

Stationery-style templates (table layout, inline styles) for the three emails guests can opt in to:

| File | Sent when | Subject |
|---|---|---|
| invite.html | A host emails their page to someone | {{title}}: help pick the name and guess the big day |
| results.html | Weekly while the poll is open, to voters who asked for results | The votes are in for {{title}} |
| arrival.html | When the host posts the announcement | {{baby_name}} is here! |

Placeholders in `{{double braces}}` are filled by the sending service (Resend, Postmark or beehiiv).
Sending is not switched on yet: it needs an email provider account and the guest opt-in on the page.
Gmail ignores web fonts, so names fall back to a script system font or Georgia in gold.
