namespace Akrho.Api.Features.Reference;

public sealed record BloodTypeDto(int BloodTypeId, string BloodTypeName);

public sealed record SkillDto(int SkillId, string SkillName);

public sealed record CorrectiveActionCategoryDto(int CategoryId, string CategoryName);

public sealed record RegionDto(int RegionId, string RegionCode, string RegionName);

public sealed record ProvinceDto(int ProvinceId, int RegionId, short ProvinceCode, string ProvinceName);

public sealed record MunicipalityDto(int MunicipalityId, int ProvinceId, short MunicipalityCode, string MunicipalityName, string? ZipCode);
