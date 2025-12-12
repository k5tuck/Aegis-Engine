// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

DECLARE_LOG_CATEGORY_EXTERN(LogAegisBridge, Log, All);

/**
 * AEGIS Bridge Module
 * Editor module that provides MCP communication and AI-powered development tools
 */
class FAegisBridgeModule : public IModuleInterface
{
public:
    /** IModuleInterface implementation */
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

    /**
     * Singleton-like access to this module's interface.
     *
     * @return Returns singleton instance, loading the module on demand if needed
     */
    static inline FAegisBridgeModule& Get()
    {
        return FModuleManager::LoadModuleChecked<FAegisBridgeModule>("AegisBridge");
    }

    /**
     * Checks to see if this module is loaded and ready.
     *
     * @return True if the module is loaded and ready to use
     */
    static inline bool IsAvailable()
    {
        return FModuleManager::Get().IsModuleLoaded("AegisBridge");
    }

    /** Get the HTTP server port */
    int32 GetHttpServerPort() const { return HttpServerPort; }

    /** Get the WebSocket server port */
    int32 GetWebSocketServerPort() const { return WebSocketServerPort; }

    /** Check if bridge is connected */
    bool IsBridgeConnected() const { return bBridgeConnected; }

    /** Set bridge connection status */
    void SetBridgeConnected(bool bConnected) { bBridgeConnected = bConnected; }

private:
    /** Initialize the Remote Control server */
    void InitializeRemoteControlServer();

    /** Initialize the WebSocket server */
    void InitializeWebSocketServer();

    /** Register AEGIS-specific Remote Control endpoints */
    void RegisterRemoteControlEndpoints();

    /** Register editor delegates */
    void RegisterEditorDelegates();

    /** Unregister editor delegates */
    void UnregisterEditorDelegates();

    /** Handle level load */
    void OnLevelLoaded(UWorld* World, const FString& LevelName);

    /** Handle actor spawned */
    void OnActorSpawned(AActor* Actor);

    /** Handle actor deleted */
    void OnActorDeleted(AActor* Actor);

    /** Handle selection changed */
    void OnSelectionChanged(UObject* Object);

private:
    int32 HttpServerPort = 30010;
    int32 WebSocketServerPort = 30020;
    bool bBridgeConnected = false;

    FDelegateHandle LevelLoadedHandle;
    FDelegateHandle ActorSpawnedHandle;
    FDelegateHandle ActorDeletedHandle;
    FDelegateHandle SelectionChangedHandle;
};
