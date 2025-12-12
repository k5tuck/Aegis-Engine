// Copyright AEGIS Team. All Rights Reserved.

using UnrealBuildTool;

public class AegisBridgeRuntime : ModuleRules
{
    public AegisBridgeRuntime(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        CppStandard = CppStandardVersion.Cpp20;

        PublicIncludePaths.AddRange(
            new string[] {
            }
        );

        PrivateIncludePaths.AddRange(
            new string[] {
            }
        );

        PublicDependencyModuleNames.AddRange(
            new string[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "Json",
                "JsonUtilities",
            }
        );

        PrivateDependencyModuleNames.AddRange(
            new string[]
            {
                "AIModule",
                "GameplayTasks",
                "NavigationSystem",
            }
        );

        // ONNX Runtime support (optional)
        if (Target.Platform == UnrealTargetPlatform.Win64 ||
            Target.Platform == UnrealTargetPlatform.Linux ||
            Target.Platform == UnrealTargetPlatform.Mac)
        {
            PublicDefinitions.Add("WITH_ONNX_RUNTIME=1");
        }
        else
        {
            PublicDefinitions.Add("WITH_ONNX_RUNTIME=0");
        }
    }
}
