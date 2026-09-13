using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Diagnostics;

namespace Akrho.Api.Common;

public static class ExceptionHandling
{
    /// <summary>Errors become ProblemDetails. An exception message never reaches the client.</summary>
    public static void UseAkrhoExceptionHandler(this WebApplication app) =>
        app.UseExceptionHandler(builder => builder.Run(async context =>
        {
            var ex = context.Features.Get<IExceptionHandlerFeature>()?.Error;
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
                                .CreateLogger("Akrho.Api");

            var (status, title) = ex switch
            {
                ScopeViolationException => (StatusCodes.Status403Forbidden,
                    "You are not permitted to access that record."),
                _ => (StatusCodes.Status500InternalServerError,
                    "Something went wrong. The problem has been recorded.")
            };

            // A scope violation is a security event, not a routine 403. Log it loudly.
            if (ex is ScopeViolationException)
                logger.LogWarning(ex, "Scope violation on {Path}", context.Request.Path);
            else
                logger.LogError(ex, "Unhandled error on {Path}", context.Request.Path);

            context.Response.StatusCode = status;
            await context.Response.WriteAsJsonAsync(new { title, status });
        }));
}
