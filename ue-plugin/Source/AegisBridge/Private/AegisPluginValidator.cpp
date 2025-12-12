// Copyright AEGIS Team. All Rights Reserved.

#include "AegisPluginValidator.h"
#include "AegisBridgeModule.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/MessageDialog.h"
#include "Framework/Notifications/NotificationManager.h"
#include "Widgets/Notifications/SNotificationList.h"
#include "HAL/PlatformProcess.h"
#include "Misc/ConfigCacheIni.h"
#include "GameProjectGenerationModule.h"

TArray<FRequiredPluginInfo> UAegisPluginValidator::GetRequiredPlugins()
{
    TArray<FRequiredPluginInfo> RequiredPlugins;

    // Remote Control - Required for MCP communication
    {
        FRequiredPluginInfo Plugin;
        Plugin.PluginName = TEXT("RemoteControl");
        Plugin.FriendlyName = TEXT("Remote Control API");
        Plugin.bRequired = true;
        Plugin.Reason = TEXT("Required for MCP server communication via HTTP/WebSocket");
        RequiredPlugins.Add(Plugin);
    }

    // WebSocket Networking - Required for real-time events
    {
        FRequiredPluginInfo Plugin;
        Plugin.PluginName = TEXT("WebSocketNetworking");
        Plugin.FriendlyName = TEXT("WebSocket Networking");
        Plugin.bRequired = true;
        Plugin.Reason = TEXT("Required for real-time bidirectional communication");
        RequiredPlugins.Add(Plugin);
    }

    // PCG - Required for procedural content generation
    {
        FRequiredPluginInfo Plugin;
        Plugin.PluginName = TEXT("PCG");
        Plugin.FriendlyName = TEXT("Procedural Content Generation");
        Plugin.bRequired = true;
        Plugin.Reason = TEXT("Required for procedural world generation features");
        RequiredPlugins.Add(Plugin);
    }

    // Houdini Engine - Optional but recommended
    {
        FRequiredPluginInfo Plugin;
        Plugin.PluginName = TEXT("HoudiniEngine");
        Plugin.FriendlyName = TEXT("Houdini Engine");
        Plugin.bRequired = false;
        Plugin.Reason = TEXT("Optional: Enables advanced procedural generation via Houdini Digital Assets");
        RequiredPlugins.Add(Plugin);
    }

    return RequiredPlugins;
}

bool UAegisPluginValidator::IsPluginEnabled(const FString& PluginName)
{
    IPluginManager& PluginManager = IPluginManager::Get();

    TSharedPtr<IPlugin> Plugin = PluginManager.FindPlugin(PluginName);
    if (Plugin.IsValid())
    {
        return Plugin->IsEnabled();
    }

    // Also check by searching all plugins
    TArray<TSharedRef<IPlugin>> AllPlugins = PluginManager.GetDiscoveredPlugins();
    for (const TSharedRef<IPlugin>& DiscoveredPlugin : AllPlugins)
    {
        if (DiscoveredPlugin->GetName() == PluginName)
        {
            return DiscoveredPlugin->IsEnabled();
        }
    }

    return false;
}

bool UAegisPluginValidator::ValidateRequiredPlugins()
{
    TArray<FRequiredPluginInfo> RequiredPlugins = GetRequiredPlugins();
    TArray<FRequiredPluginInfo> MissingRequired;
    TArray<FRequiredPluginInfo> MissingOptional;

    for (const FRequiredPluginInfo& PluginInfo : RequiredPlugins)
    {
        if (!IsPluginEnabled(PluginInfo.PluginName))
        {
            if (PluginInfo.bRequired)
            {
                MissingRequired.Add(PluginInfo);
                UE_LOG(LogAegisBridge, Warning, TEXT("Required plugin not enabled: %s"), *PluginInfo.FriendlyName);
            }
            else
            {
                MissingOptional.Add(PluginInfo);
                UE_LOG(LogAegisBridge, Log, TEXT("Optional plugin not enabled: %s"), *PluginInfo.FriendlyName);
            }
        }
    }

    // Show notification for optional plugins
    if (MissingOptional.Num() > 0)
    {
        FString OptionalList;
        for (const FRequiredPluginInfo& Plugin : MissingOptional)
        {
            OptionalList += FString::Printf(TEXT("\n  - %s: %s"), *Plugin.FriendlyName, *Plugin.Reason);
        }

        ShowNotification(
            FText::Format(
                NSLOCTEXT("AegisBridge", "OptionalPlugins", "AEGIS: Optional plugins not enabled:{0}"),
                FText::FromString(OptionalList)
            ),
            false
        );
    }

    // Show dialog for required plugins
    if (MissingRequired.Num() > 0)
    {
        ShowMissingPluginsDialog(MissingRequired);
        return false;
    }

    UE_LOG(LogAegisBridge, Log, TEXT("All required AEGIS plugins are enabled"));
    return true;
}

void UAegisPluginValidator::ShowMissingPluginsDialog(const TArray<FRequiredPluginInfo>& MissingPlugins)
{
    // Build the message
    FString PluginList;
    for (const FRequiredPluginInfo& Plugin : MissingPlugins)
    {
        PluginList += FString::Printf(TEXT("\n\n• %s\n   %s"), *Plugin.FriendlyName, *Plugin.Reason);
    }

    FText Title = NSLOCTEXT("AegisBridge", "MissingPluginsTitle", "AEGIS - Required Plugins Missing");
    FText Message = FText::Format(
        NSLOCTEXT("AegisBridge", "MissingPluginsMessage",
            "AEGIS Bridge requires the following plugins to be enabled:{0}\n\n"
            "Would you like to enable these plugins now?\n\n"
            "Note: The editor will need to restart after enabling plugins."
        ),
        FText::FromString(PluginList)
    );

    // Show dialog with Yes/No options
    EAppReturnType::Type Result = FMessageDialog::Open(
        EAppMsgType::YesNo,
        Message,
        Title
    );

    if (Result == EAppReturnType::Yes)
    {
        bool bNeedsRestart = false;

        for (const FRequiredPluginInfo& Plugin : MissingPlugins)
        {
            if (EnablePlugin(Plugin.PluginName))
            {
                bNeedsRestart = true;
                UE_LOG(LogAegisBridge, Log, TEXT("Enabled plugin: %s"), *Plugin.PluginName);
            }
            else
            {
                UE_LOG(LogAegisBridge, Error, TEXT("Failed to enable plugin: %s"), *Plugin.PluginName);
            }
        }

        if (bNeedsRestart)
        {
            // Ask user to restart
            FText RestartTitle = NSLOCTEXT("AegisBridge", "RestartTitle", "Restart Required");
            FText RestartMessage = NSLOCTEXT("AegisBridge", "RestartMessage",
                "Plugins have been enabled. The editor needs to restart for changes to take effect.\n\n"
                "Would you like to restart now?"
            );

            if (FMessageDialog::Open(EAppMsgType::YesNo, RestartMessage, RestartTitle) == EAppReturnType::Yes)
            {
                // Request editor restart
                FUnrealEdMisc::Get().RestartEditor(false);
            }
        }
    }
    else
    {
        // User declined - show warning
        ShowNotification(
            NSLOCTEXT("AegisBridge", "PluginsDeclined",
                "AEGIS: Required plugins not enabled. Some features will be unavailable."
            ),
            true
        );
    }
}

bool UAegisPluginValidator::EnablePlugin(const FString& PluginName)
{
    IPluginManager& PluginManager = IPluginManager::Get();

    TSharedPtr<IPlugin> Plugin = PluginManager.FindPlugin(PluginName);
    if (!Plugin.IsValid())
    {
        // Try to find by searching
        TArray<TSharedRef<IPlugin>> AllPlugins = PluginManager.GetDiscoveredPlugins();
        for (const TSharedRef<IPlugin>& DiscoveredPlugin : AllPlugins)
        {
            if (DiscoveredPlugin->GetName() == PluginName)
            {
                Plugin = DiscoveredPlugin;
                break;
            }
        }
    }

    if (!Plugin.IsValid())
    {
        UE_LOG(LogAegisBridge, Error, TEXT("Plugin not found: %s"), *PluginName);
        return false;
    }

    // Enable the plugin
    FText FailReason;
    bool bSuccess = IProjectManager::Get().SetPluginEnabled(PluginName, true, FailReason);

    if (!bSuccess)
    {
        UE_LOG(LogAegisBridge, Error, TEXT("Failed to enable plugin %s: %s"), *PluginName, *FailReason.ToString());
    }

    return bSuccess;
}

void UAegisPluginValidator::ShowNotification(const FText& Message, bool bIsError)
{
    FNotificationInfo Info(Message);
    Info.bFireAndForget = true;
    Info.ExpireDuration = bIsError ? 10.0f : 5.0f;
    Info.bUseThrobber = false;
    Info.bUseLargeFont = false;

    if (bIsError)
    {
        Info.Image = FCoreStyle::Get().GetBrush(TEXT("Icons.Error"));
    }
    else
    {
        Info.Image = FCoreStyle::Get().GetBrush(TEXT("Icons.Warning"));
    }

    FSlateNotificationManager::Get().AddNotification(Info);
}
