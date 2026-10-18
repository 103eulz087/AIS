using Akrho.Infrastructure.Repositories;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Akrho.Infrastructure.Routing;

/// <summary>
/// Hourly sweep that moves open chapter registrations off councils nobody is seated on any
/// more (usp_ChapterRegistration_RerouteFromDormant with no council filter). An unseat already
/// re-routes in its own transaction; this catches the two cases no request ever triggers: a
/// fixed term (MemberRole.TermEnd) simply running out, and a registration filed to a council
/// during the day its last officer was unseated (that seat still counts as seated until the
/// day ends, so routing at submit time still picked it).
/// </summary>
public sealed class RegistrationRerouteHostedService(
    IServiceScopeFactory scopeFactory, ILogger<RegistrationRerouteHostedService> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var repo = scope.ServiceProvider.GetRequiredService<IChapterRegistrationRepository>();
                var moved = await repo.RerouteFromDormantAsync(stoppingToken);
                if (moved > 0)
                    logger.LogInformation("Re-routed {Count} chapter registration(s) off councils with no officers seated.", moved);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // A failed sweep must never take the API down; the next tick retries.
                logger.LogError(ex, "Chapter registration re-routing sweep failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
