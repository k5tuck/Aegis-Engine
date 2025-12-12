// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "AegisPluginValidator.generated.h"

/**
 * Required plugin information
 */
USTRUCT()
struct FRequiredPluginInfo
{
    GENERATED_BODY()

    UPROPERTY()
    FString PluginName;

    UPROPERTY()
    FString FriendlyName;

    UPROPERTY()
    bool bRequired = true;

    UPROPERTY()
    FString Reason;
};

/**
 * AEGIS Plugin Validator
 * Checks for required plugins and prompts user to enable them
 */
UCLASS()
class AEGISBRIDGE_API UAegisPluginValidator : public UObject
{
    GENERATED_BODY()

public:
    /** Validate all required plugins are enabled */
    static bool ValidateRequiredPlugins();

    /** Check if a specific plugin is enabled */
    static bool IsPluginEnabled(const FString& PluginName);

    /** Show dialog to enable missing plugins */
    static void ShowMissingPluginsDialog(const TArray<FRequiredPluginInfo>& MissingPlugins);

    /** Enable a plugin (requires editor restart) */
    static bool EnablePlugin(const FString& PluginName);

    /** Get list of required plugins */
    static TArray<FRequiredPluginInfo> GetRequiredPlugins();

private:
    /** Show notification banner */
    static void ShowNotification(const FText& Message, bool bIsError);
};
