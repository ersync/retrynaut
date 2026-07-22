# Security

Please report security problems privately to `contact@emadrahimi.dev` instead
of opening a public issue.

Useful reports include non-loopback connections, unsafe target selection,
startup command injection, overly broad button matching, or unexpected network
requests. Status and shutdown use an authenticated socket or named pipe in the
current user's session. Its authentication key is stored in the Retrynaut config
directory; reports about crossing that user boundary are especially useful.
