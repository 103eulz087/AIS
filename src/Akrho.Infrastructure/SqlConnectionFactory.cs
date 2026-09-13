using System.Data;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure;

public interface ISqlConnectionFactory
{
    Task<IDbConnection> OpenAsync(CancellationToken ct);
}

public sealed class SqlConnectionFactory(string connectionString) : ISqlConnectionFactory
{
    public async Task<IDbConnection> OpenAsync(CancellationToken ct)
    {
        var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        return conn;
    }
}
