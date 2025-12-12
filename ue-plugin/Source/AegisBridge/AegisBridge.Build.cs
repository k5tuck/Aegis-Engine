// Copyright AEGIS Team. All Rights Reserved.

using UnrealBuildTool;

public class AegisBridge : ModuleRules
{
    public AegisBridge(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        // C++20 for modern features
        CppStandard = CppStandardVersion.Cpp20;

        PublicIncludePaths.AddRange(
            new string[] {
                // ... add public include paths required here ...
            }
        );

        PrivateIncludePaths.AddRange(
            new string[] {
                // ... add other private include paths required here ...
            }
        );

        PublicDependencyModuleNames.AddRange(
            new string[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "InputCore",
                "Json",
                "JsonUtilities",
                "HTTP",
                "WebSockets",
                "RemoteControl",
                "RemoteControlCommon",
                "AegisBridgeRuntime",
            }
        );

        PrivateDependencyModuleNames.AddRange(
            new string[]
            {
                "Slate",
                "SlateCore",
                "UnrealEd",
                "EditorStyle",
                "EditorSubsystem",
                "LevelEditor",
                "Landscape",
                "Foliage",
                "PCG",
                "AIModule",
                "NavigationSystem",
                "GameplayTasks",
            }
        );

        // Optional Houdini Engine dependency
        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.AddRange(
                new string[]
                {
                    "HoudiniEngineRuntime",
                    "HoudiniEngineEditor",
                }
            );

            PublicDefinitions.Add("WITH_HOUDINI_ENGINE=1");
        }
        else
        {
            PublicDefinitions.Add("WITH_HOUDINI_ENGINE=0");
        }

        DynamicallyLoadedModuleNames.AddRange(
            new string[]
            {
                // ... add any modules that your module loads dynamically here ...
            }
        );
    }
}
