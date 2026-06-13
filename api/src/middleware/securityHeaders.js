"use strict";

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // TODO(production): Tighten CSP only after migrating the required inline script/style usage and CDN dependencies.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
      "img-src 'self' data: https://tfcmaps.net https://*.steamstatic.com https://steamcdn-a.akamaihd.net; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
      "frame-src https://player.twitch.tv; connect-src 'self'"
  );
  next();
}

module.exports = { securityHeaders };
