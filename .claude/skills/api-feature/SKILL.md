---
name: api-feature
description: Add a feature slice to the ASP.NET Core API — folder layout, endpoint mapping, DTOs, validation, scoping and error handling. Use when adding or changing any HTTP endpoint.
---

# Adding an API feature

One feature = one folder: `src/Akrho.Api/Features/<Feature>/`.

```
Features/Members/
  MembersEndpoints.cs      mapping + handlers
  MemberDtos.cs            request and response records
  MemberValidators.cs      FluentValidation
```

## Endpoint template

```csharp
public static class MembersEndpoints
{
    public static RouteGroupBuilder MapMembers(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/members").WithTags("Members").RequireAuthorization();

        g.MapGet("", Search).WithName("SearchMembers");
        g.MapGet("{id:int}", GetById).WithName("GetMember");
        return (RouteGroupBuilder)g;
    }

    private static async Task<Results<Ok<PagedResult<MemberListDto>>, ValidationProblem>> Search(
        [AsParameters] MemberSearchRequest req,
        IMemberRepository repo,
        ICurrentUser caller,                  // never take the caller from the request
        IValidator<MemberSearchRequest> validator,
        CancellationToken ct)
    {
        var v = await validator.ValidateAsync(req, ct);
        if (!v.IsValid) return TypedResults.ValidationProblem(v.ToDictionary());

        var page = await repo.SearchAsync(caller.MemberId, req, ct);
        return TypedResults.Ok(page);
    }
}
```

## Rules

1. **Scope comes from the token, never the body.** `ICurrentUser.MemberId` is the only source of
   truth for who is asking. A `chapterId` in a request is a filter, not an authorisation.
2. **Typed results.** `Results<Ok<T>, NotFound, ForbidHttpResult>`, not `IResult` or `object`.
3. **Validate at the edge** with FluentValidation. Repositories assume valid input.
4. **`decimal` for money**, `DateOnly` for calendar dates, UTC `DateTime` for timestamps.
5. **Errors are ProblemDetails.** Never surface an exception message.
6. **`CancellationToken` on every I/O call.**

## Visibility-sensitive DTOs

Some entities have two response shapes. Picking the wrong one is a privacy incident:

| Entity | Restricted shape | Full shape |
|---|---|---|
| Corrective action | `CorrectiveActionSummaryDto` — member, category, status, date | `CorrectiveActionFullDto` — adds `Content`. Officers and the member concerned only |
| Member, cross-chapter | `MemberCrossChapterDto` — gift name, chapter, status | `MemberDto` — same chapter only |

The restricted shape must **omit** the field, not send it empty. Absent is safe; empty invites a
later refactor to fill it in.

## Never

- No arrears, balance-owed or amount-due field anywhere. Contributions are voluntary.
- No inline SQL. Ask the `database` agent for a procedure.
- No `_audit.Write(...)` in a handler. Auditing is an interceptor.
