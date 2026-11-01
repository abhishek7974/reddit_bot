export * from './enums.js';
export * from './api.js';

/**
 * Route catalogue (all JSON, all under /api). Roles: V = VIEWER, R = REVIEWER, A = ADMIN.
 * Higher roles include lower ones.
 *
 *  GET    /api/health                              public   liveness
 *  POST   /api/auth/login        LoginBody          public   -> SessionResponse (sets cookie)
 *  POST   /api/auth/logout                          V
 *  GET    /api/auth/me                              V        -> SessionResponse
 *
 *  GET    /api/dashboard/summary                    V        -> DashboardSummary
 *  GET    /api/metrics?days=                        V        -> MetricsResponse
 *  GET    /api/system/health                        V        -> SystemHealth
 *
 *  GET    /api/conversations?…                      V        -> Paginated<ConversationSummary>
 *  GET    /api/conversations/:id                    V        -> ConversationDetail
 *  POST   /api/conversations/:id/generate-draft     R        -> DraftDetail
 *  POST   /api/conversations/:id/purge              A        -> { purged: true }
 *  POST   /api/discovery/run                        R        -> DiscoveryRunResponse
 *  GET    /api/discovery/settings                   V        -> DiscoverySettingsDto
 *  PUT    /api/discovery/settings  DiscoverySettingsBody  A  -> DiscoverySettingsDto
 *
 *  GET    /api/drafts?…                             V        -> Paginated<DraftSummary>
 *  GET    /api/drafts/:id                           V        -> DraftDetail
 *  POST   /api/drafts/:id/approve  ApproveDraftBody R        -> DraftDetail
 *  POST   /api/drafts/:id/reject   RejectDraftBody  R        -> DraftDetail
 *  POST   /api/drafts/:id/publish                   A        -> PublishResponse  (header Idempotency-Key optional)
 *
 *  GET    /api/policies                             V        -> SubredditPolicyDto[]
 *  POST   /api/policies            {communityName}  A        -> SubredditPolicyDto (created UNKNOWN / disabled)
 *  PATCH  /api/policies/:id        UpdatePolicyBody A        -> SubredditPolicyDto
 *
 *  GET    /api/brand-profile                        V        -> BrandProfileDto
 *  PATCH  /api/brand-profile  UpdateBrandProfileBody A       -> BrandProfileDto
 *
 *  GET    /api/admin/publishing                     V        -> PublishingStateDto
 *  POST   /api/admin/publishing/pause   {reason}    A        -> PublishingStateDto
 *  POST   /api/admin/publishing/resume  {reason}    A        -> PublishingStateDto
 *  GET    /api/admin/platform-authorization         V        -> PlatformAuthorizationDto
 *  PATCH  /api/admin/platform-authorization         A        -> PlatformAuthorizationDto
 *  GET    /api/audit?…                              A        -> Paginated<AuditEventDto>
 *
 *  OpenAPI JSON: GET /api/docs/json   Swagger UI: /api/docs
 */
export const API_PREFIX = '/api';
