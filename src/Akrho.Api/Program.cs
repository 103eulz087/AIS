using System.Text;
using System.Threading.RateLimiting;
using Akrho.Api.Common;
using Akrho.Api.Features.Activities;
using Akrho.Api.Features.Attachments;
using Akrho.Api.Features.Auth;
using Akrho.Api.Features.Chapters;
using Akrho.Api.Features.ChapterRegistrations;
using Akrho.Api.Features.Chat;
using Akrho.Api.Features.Communications;
using Akrho.Api.Features.Conversations;
using Akrho.Api.Features.CouncilStatistics;
using Akrho.Api.Features.Councils;
using Akrho.Api.Features.Credential;
using Akrho.Api.Features.Dashboard;
using Akrho.Api.Features.Discipline;
using Akrho.Api.Features.Donations;
using Akrho.Api.Features.Enrolment;
using Akrho.Api.Features.Expenses;
using Akrho.Api.Features.IdCardExport;
using Akrho.Api.Features.Ledger;
using Akrho.Api.Features.Meetings;
using Akrho.Api.Features.Members;
using Akrho.Api.Features.MembershipApplications;
using Akrho.Api.Features.Notifications;
using Akrho.Api.Features.Reference;
using Akrho.Api.Features.Verification;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Push;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using Serilog;

const string DevOnlyPlaceholderJwtKey = "DEV-ONLY-REPLACE-VIA-ENVIRONMENT-VARIABLE-32CHARS-MIN";

// Unlike the JWT signing key above, a VAPID key pair cannot be an arbitrary placeholder
// STRING — Lib.Net.Http.WebPush's VapidAuthentication constructor base64url-decodes both
// keys immediately and throws if either is malformed, so a literal "DEV-ONLY-REPLACE..."
// value here would crash the app at startup, in every environment, including Development.
// This is a real (but throwaway) P-256 key pair generated for this repository's own local
// development — leaking it carries no risk beyond letting someone send a push "from" a dev
// box nobody's browser is subscribed to; it authenticates the sending application to the
// push service, it is not a credential for any account or member data. devops provisions
// the real production pair outside source control, exactly like Jwt:SigningKey.
const string DevOnlyPlaceholderVapidPrivateKey = "f8EEhVV_AW1HXa6qEPlCishmJdD1bX4p4TJYHb3KDag";

var builder = WebApplication.CreateBuilder(args);

// Local-only overrides (CLAUDE.md §10) — NEVER committed, matched by the
// appsettings.*.local.json .gitignore rule. ASP.NET Core's own default configuration
// sources stop at appsettings.{Environment}.json; nothing loads a ".local.json" variant
// unless it is added explicitly, which is what this line does. Without it, a connection
// string placed in appsettings.Development.local.json for the shared dev SQL Server was
// silently ignored, and the app fell back to the Docker-default localhost connection
// string baked into appsettings.json instead — working only in whichever terminal
// session happened to still have ConnectionStrings__Akrho exported, and failing (every
// DB call, sign-in included, throwing a generic 500) in every fresh one, including after
// a reboot. Loaded after the environment-specific file and before Serilog reads
// configuration, so a local override can also affect logging if one is ever added.
builder.Configuration.AddJsonFile(
    $"appsettings.{builder.Environment.EnvironmentName}.local.json", optional: true, reloadOnChange: true);

builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .WriteTo.Console()
    .WriteTo.File("logs/akrho-.log", rollingInterval: RollingInterval.Day));

var connectionString = builder.Configuration.GetConnectionString("Akrho")
    ?? throw new InvalidOperationException("ConnectionStrings:Akrho is not configured.");

builder.Services.AddSingleton<ISqlConnectionFactory>(_ => new SqlConnectionFactory(connectionString));
builder.Services.AddScoped<IMemberRepository, MemberRepository>();
builder.Services.AddScoped<ILedgerRepository, LedgerRepository>();
builder.Services.AddScoped<IAuthRepository, AuthRepository>();
builder.Services.AddScoped<IEnrolmentRepository, EnrolmentRepository>();
builder.Services.AddScoped<IMeetingRepository, MeetingRepository>();
builder.Services.AddScoped<IAnnouncementRepository, AnnouncementRepository>();
builder.Services.AddScoped<IMemoRepository, MemoRepository>();
builder.Services.AddScoped<IDocumentRepository, DocumentRepository>();
builder.Services.AddScoped<IActivityRepository, ActivityRepository>();
builder.Services.AddScoped<IExpenseRepository, ExpenseRepository>();
builder.Services.AddScoped<IDonationRepository, DonationRepository>();
builder.Services.AddScoped<IAttachmentRepository, AttachmentRepository>();
builder.Services.AddScoped<IChapterRepository, ChapterRepository>();
builder.Services.AddScoped<IChapterInviteLinkRepository, ChapterInviteLinkRepository>();
builder.Services.AddScoped<IMembershipApplicationRepository, MembershipApplicationRepository>();
builder.Services.AddScoped<IMemberProfileRepository, MemberProfileRepository>();
builder.Services.AddScoped<IReferenceRepository, ReferenceRepository>();
builder.Services.AddScoped<ICorrectiveActionRepository, CorrectiveActionRepository>();
builder.Services.AddScoped<IDashboardRepository, DashboardRepository>();
builder.Services.AddScoped<ICredentialRepository, CredentialRepository>();
builder.Services.AddScoped<IChatRepository, ChatRepository>();
builder.Services.AddScoped<IPushRepository, PushRepository>();
builder.Services.AddScoped<IChapterRegistrationRepository, ChapterRegistrationRepository>();
builder.Services.AddScoped<IIdCardExportRepository, IdCardExportRepository>();
builder.Services.AddScoped<IScanLogRepository, ScanLogRepository>();
builder.Services.AddScoped<IPublicVerificationRepository, PublicVerificationRepository>();
builder.Services.AddScoped<ICouncilStatisticsRepository, CouncilStatisticsRepository>();
builder.Services.AddScoped<IMemberAccountActionRepository, MemberAccountActionRepository>();
builder.Services.AddScoped<ICouncilSeatingRepository, CouncilSeatingRepository>();
builder.Services.AddScoped<IChapterOfficerRepository, ChapterOfficerRepository>();
builder.Services.AddSingleton<IPasswordHasherService, PasswordHasherService>();
builder.Services.AddSingleton<IAccessTokenService, AccessTokenService>();
builder.Services.AddSingleton<IScopeGuard, ScopeGuard>();
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();

// The Public chat module's real-time push. First SignalR hub in this project — see
// ChatHub.cs for why it has zero client-callable methods.
builder.Services.AddSignalR();

// Push-dispatch worker (Chat module slice 2 — private chat + push notifications). Registered
// once as a singleton and exposed under two roles: the actual IHostedService the runtime
// drives, and IPushJobEnqueuer, the only thing a feature endpoint is allowed to depend on to
// enqueue a job (see PushJob.cs's own header comment on why an endpoint never touches the
// worker's internals directly).
builder.Services.AddSingleton<IPushSender, PushSender>();
builder.Services.AddSingleton<PushDispatchHostedService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<PushDispatchHostedService>());
builder.Services.AddSingleton<IPushJobEnqueuer>(sp => sp.GetRequiredService<PushDispatchHostedService>());

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser>(sp =>
{
    var principal = sp.GetRequiredService<IHttpContextAccessor>().HttpContext?.User
        ?? throw new InvalidOperationException("No HTTP context.");
    return new CurrentUser(principal);
});

builder.Services.AddValidatorsFromAssemblyContaining<MemberSearchRequestValidator>();

var jwtKey = builder.Configuration["Jwt:SigningKey"]
    ?? throw new InvalidOperationException("Jwt:SigningKey is not configured.");

// Real auth now mints real access tokens — the placeholder key in appsettings.json is
// fine for Development only. Anywhere else, boot must fail loudly rather than sign
// tokens with a key that is checked into source control.
if (!builder.Environment.IsDevelopment() && jwtKey == DevOnlyPlaceholderJwtKey)
    throw new InvalidOperationException(
        "Jwt:SigningKey is still the development placeholder. Configure a real signing " +
        "key (environment variable or a non-tracked settings file) before running outside Development.");

// Same posture as the JWT signing key above: a real (generated-for-dev, never shared)
// keypair ships in appsettings.json so Development works out of the box; devops provisions
// the real production pair outside source control. PushSender/NotificationsEndpoints both
// throw their own clear "not configured" error if either key is missing entirely.
var vapidPrivateKey = builder.Configuration["Push:VapidPrivateKey"];
if (!builder.Environment.IsDevelopment() && vapidPrivateKey == DevOnlyPlaceholderVapidPrivateKey)
    throw new InvalidOperationException(
        "Push:VapidPrivateKey is still the development placeholder. Configure a real VAPID " +
        "key pair (environment variable or a non-tracked settings file) before running outside Development.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        // The token is minted from a plain claim list (see AccessTokenService), not a
        // ClaimsIdentity + SecurityTokenDescriptor, so there is no legacy short-name
        // remapping to undo on the way back in either.
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        // Browsers cannot set an Authorization header on a WebSocket handshake, so
        // SignalR's own client falls back to an access_token query-string parameter for
        // that one transport. Scoped narrowly to /hubs/chat ONLY, via the path check below
        // — no ordinary REST endpoint gains a query-string auth path from this.
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) &&
                    context.HttpContext.Request.Path.StartsWithSegments("/hubs/chat"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });
// Named policies deliberately narrower than ICurrentUser.IsChapterOfficer, which also
// matches ChapterTreasurer — he has no meeting-write right per the AIS role table.
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthorizationPolicies.ChapterMeetingsWrite, p =>
        p.RequireRole("ChapterOfficer", "ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterMeetingsFinalize, p =>
        p.RequireRole("ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterLedgerCorrect, p =>
        p.RequireRole("ChapterTreasurer", "ChapterAdmin"));

    // Registered ahead of the modules that use them (Expenses/Donations, Announcements/
    // Memos, Corrective Actions) so nothing later blocks on adding a policy — no endpoint
    // references these yet.
    options.AddPolicy(AuthorizationPolicies.ChapterMoneyWrite, p =>
        p.RequireRole("ChapterTreasurer", "ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterMoneyVoid, p =>
        p.RequireRole("ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterActivitiesWrite, p =>
        p.RequireRole("ChapterOfficer", "ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterCommsWrite, p =>
        p.RequireRole("ChapterOfficer", "ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterDisciplineWrite, p =>
        p.RequireRole("ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterMembershipApprove, p =>
        p.RequireRole("ChapterAdmin"));
    // ChapterAdmin (the ordinary "forgot his password" case) OR CouncilSecretary/CouncilAdmin
    // (a brand-new chapter's first President — no ChapterAdmin exists yet to reissue his own
    // very first link). usp_Enrolment_Issue's own "Bounded Council Issuer" branch is what
    // actually narrows the council case down further (first-credential-only, jurisdiction-
    // scoped) — this policy only needed to stop being narrower than that procedure.
    options.AddPolicy(AuthorizationPolicies.ChapterMembersEnrolmentReissue, p =>
        p.RequireRole("ChapterAdmin", "CouncilSecretary", "CouncilAdmin"));

    // A new, narrow policy for the Public chat module — same role set as
    // usp_ChatMessage_Delete/_ResolveFlags/_GetFlagged's own checks. Not a reuse of
    // ChapterCommsWrite/ChapterDisciplineWrite: chat moderation is its own capability with
    // its own procedures and THROW numbers, kept as its own named policy per this codebase's
    // one-policy-per-capability convention.
    options.AddPolicy(AuthorizationPolicies.ChapterChatModerate, p =>
        p.RequireRole("ChapterOfficer", "ChapterAdmin"));

    // Chapter-registration module (db/schema/17_chapter_registration.sql). ChapterAuditor is
    // seeded read-only (GrantsLogin=1, but no write capability anywhere) and must NEVER be
    // added to either council policy below — see AuthorizationPolicies' own comments on both.
    options.AddPolicy(AuthorizationPolicies.ChapterOfficerRosterFile, p =>
        p.RequireRole("ChapterAdmin"));
    options.AddPolicy(AuthorizationPolicies.CouncilChapterRegistrationVerify, p =>
        p.RequireRole("CouncilSecretary", "CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.CouncilChapterRegistrationApprove, p =>
        p.RequireRole("CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.CouncilStatisticsRead, p =>
        p.RequireRole("CouncilSecretary", "CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.NationalMemberAccountManage, p =>
        p.RequireRole("CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.CouncilSeatOfficer, p =>
        p.RequireRole("CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.CouncilRegistryRead, p =>
        p.RequireRole("CouncilSecretary", "CouncilAdmin", "CouncilTreasurer", "CouncilOfficer", "CouncilPIO"));
    options.AddPolicy(AuthorizationPolicies.ChapterOfficerSeat, p =>
        p.RequireRole("ChapterAdmin", "CouncilAdmin"));
    options.AddPolicy(AuthorizationPolicies.ChapterMemberIdentityEdit, p =>
        p.RequireRole("ChapterAdmin"));
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Sign-in and enrolment-complete accept a caller-supplied secret and must not be
// hammerable — a handful of tries per minute per caller IP is plenty for a real officer.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    o.AddPolicy(RateLimiting.SignIn, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    o.AddPolicy(RateLimiting.EnrolmentComplete, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // The caller here is already authenticated (unlike SignIn/EnrolmentComplete), so this
    // partitions by member id rather than IP — a handful of receipt photos per minute per
    // officer is plenty, without one shared chapter NAT/proxy throttling every officer at once.
    o.AddPolicy(RateLimiting.AttachmentUpload, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // A member re-taking/re-choosing his own profile photo a handful of times a minute is
    // plenty; same member-id partitioning as AttachmentUpload, for the same reason (already
    // authenticated, so no shared-IP proxy should throttle every member at once).
    o.AddPolicy(RateLimiting.ProfilePhotoUpload, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Public, unauthenticated sign-up — there is no member id to partition by (unlike
    // AttachmentUpload above), so both membership-application policies partition by caller
    // IP instead, the same way SignIn/EnrolmentComplete do.
    o.AddPolicy(RateLimiting.MembershipApplicationSubmit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    o.AddPolicy(RateLimiting.MembershipApplicationStatus, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Public chat — already authenticated, so both partition by member id like
    // AttachmentUpload/ProfilePhotoUpload above (one chapter's shared NAT/proxy must not
    // throttle every member at once).
    o.AddPolicy(RateLimiting.ChatPost, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    o.AddPolicy(RateLimiting.ChatFlag, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Private chat (Features/Conversations) — already authenticated, so this partitions by
    // member id, same reasoning and same 20/minute limit as ChatPost above.
    o.AddPolicy(RateLimiting.PrivateChatPost, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Starting a brand-new DM thread — the only control this slice has on who may be
    // contacted at all, so it is tighter than PrivateChatPost.
    o.AddPolicy(RateLimiting.ConversationStart, http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("mid")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Public, unauthenticated chapter-charter petition — no member id to partition by, same
    // reasoning as MembershipApplicationSubmit above.
    o.AddPolicy(RateLimiting.ChapterRegistrationSubmit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    o.AddPolicy(RateLimiting.ChapterRegistrationStatus, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));

    // Public, unauthenticated credential scan/verify — no member id to partition by, same
    // reasoning as MembershipApplicationStatus/ChapterRegistrationStatus above.
    o.AddPolicy(RateLimiting.CredentialVerify, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

app.UseAkrhoExceptionHandler();
app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// HTTPS is not optional: getUserMedia — and therefore all QR scanning — requires a
// secure context, and so does PWA installation. See CLAUDE.md §8.
app.UseHttpsRedirection();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", utc = DateTime.UtcNow }))
   .AllowAnonymous().WithTags("Health");

app.MapMembers();
app.MapLedger();
app.MapAuth();
app.MapEnrolment();
app.MapMeetings();
app.MapCommunications();
app.MapActivities();
app.MapExpenses();
app.MapDonations();
app.MapAttachments();
app.MapChapters();
app.MapMembershipApplications();
app.MapReference();
app.MapCorrectiveActions();
app.MapDashboard();
app.MapCredential();
app.MapChat();
app.MapConversations();
app.MapNotifications();
app.MapChapterRegistrations();
app.MapCouncilStatistics();
app.MapCouncils();
app.MapIdCardExport();
app.MapVerification();

// /?access_token= is honoured ONLY here (see the JwtBearerEvents.OnMessageReceived path
// check above) — every other endpoint in this app still requires a real Authorization header.
app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();

app.Run();

public partial class Program;   // exposed for WebApplicationFactory in tests
