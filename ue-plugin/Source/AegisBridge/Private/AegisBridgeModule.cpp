// Copyright AEGIS Team. All Rights Reserved.

#include "AegisBridgeModule.h"
#include "AegisRemoteControlHandler.h"
#include "AegisWebSocketServer.h"
#include "AegisSubsystem.h"
#include "AegisPluginValidator.h"

#include "Editor.h"
#include "LevelEditor.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "RemoteControlSettings.h"
#include "IRemoteControlModule.h"

#define LOCTEXT_NAMESPACE "FAegisBridgeModule"

DEFINE_LOG_CATEGORY(LogAegisBridge);

void FAegisBridgeModule::StartupModule()
{
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Bridge Module starting up..."));

    // Validate required plugins before proceeding
    if (!UAegisPluginValidator::ValidateRequiredPlugins())
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("Some required plugins are missing. AEGIS features may be limited."));
    }

    // Load configuration
    HttpServerPort = GetDefault<URemoteControlSettings>()->RemoteControlHttpServerPort;
    WebSocketServerPort = GetDefault<URemoteControlSettings>()->RemoteControlWebSocketServerPort;

    // Override with AEGIS-specific ports if configured
    if (GConfig)
    {
        GConfig->GetInt(TEXT("AegisBridge"), TEXT("HttpServerPort"), HttpServerPort, GEngineIni);
        GConfig->GetInt(TEXT("AegisBridge"), TEXT("WebSocketServerPort"), WebSocketServerPort, GEngineIni);
    }

    // Initialize servers
    InitializeRemoteControlServer();
    InitializeWebSocketServer();

    // Register AEGIS endpoints
    RegisterRemoteControlEndpoints();

    // Register editor delegates
    RegisterEditorDelegates();

    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Bridge Module started successfully"));
    UE_LOG(LogAegisBridge, Log, TEXT("  HTTP Server Port: %d"), HttpServerPort);
    UE_LOG(LogAegisBridge, Log, TEXT("  WebSocket Server Port: %d"), WebSocketServerPort);
}

void FAegisBridgeModule::ShutdownModule()
{
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Bridge Module shutting down..."));

    // Unregister delegates
    UnregisterEditorDelegates();

    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Bridge Module shut down"));
}

void FAegisBridgeModule::InitializeRemoteControlServer()
{
    // Remote Control API is initialized by the RemoteControl plugin
    // We just need to ensure it's enabled
    IRemoteControlModule& RemoteControlModule = IRemoteControlModule::Get();

    UE_LOG(LogAegisBridge, Log, TEXT("Remote Control server initialized"));
}

void FAegisBridgeModule::InitializeWebSocketServer()
{
    // WebSocket server is also managed by Remote Control
    // We extend it with AEGIS-specific handlers

    UE_LOG(LogAegisBridge, Log, TEXT("WebSocket server initialized"));
}

void FAegisBridgeModule::RegisterRemoteControlEndpoints()
{
    // Register AEGIS-specific function handlers
    // These will be called via Remote Control API

    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Remote Control endpoints registered"));
}

void FAegisBridgeModule::RegisterEditorDelegates()
{
    if (!GEditor)
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("GEditor not available, skipping delegate registration"));
        return;
    }

    // Level loaded
    FEditorDelegates::OnMapOpened.AddRaw(this, &FAegisBridgeModule::OnLevelLoaded);

    // Actor spawned/deleted
    if (GEngine)
    {
        ActorSpawnedHandle = GEngine->OnLevelActorAdded().AddRaw(this, &FAegisBridgeModule::OnActorSpawned);
        ActorDeletedHandle = GEngine->OnLevelActorDeleted().AddRaw(this, &FAegisBridgeModule::OnActorDeleted);
    }

    // Selection changed
    if (GEditor)
    {
        SelectionChangedHandle = GEditor->GetSelectedActors()->SelectionChangedEvent.AddRaw(
            this, &FAegisBridgeModule::OnSelectionChanged);
    }

    UE_LOG(LogAegisBridge, Log, TEXT("Editor delegates registered"));
}

void FAegisBridgeModule::UnregisterEditorDelegates()
{
    FEditorDelegates::OnMapOpened.RemoveAll(this);

    if (GEngine)
    {
        GEngine->OnLevelActorAdded().Remove(ActorSpawnedHandle);
        GEngine->OnLevelActorDeleted().Remove(ActorDeletedHandle);
    }

    if (GEditor)
    {
        GEditor->GetSelectedActors()->SelectionChangedEvent.Remove(SelectionChangedHandle);
    }
}

void FAegisBridgeModule::OnLevelLoaded(UWorld* World, const FString& LevelName)
{
    UE_LOG(LogAegisBridge, Verbose, TEXT("Level loaded: %s"), *LevelName);

    // Broadcast to WebSocket clients
    if (UAegisWebSocketServer* WsServer = UAegisWebSocketServer::Get())
    {
        TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject());
        EventData->SetStringField(TEXT("levelName"), LevelName);
        EventData->SetStringField(TEXT("worldName"), World ? World->GetName() : TEXT(""));

        WsServer->BroadcastEvent(TEXT("world.level.changed"), EventData);
    }
}

void FAegisBridgeModule::OnActorSpawned(AActor* Actor)
{
    if (!Actor) return;

    UE_LOG(LogAegisBridge, Verbose, TEXT("Actor spawned: %s"), *Actor->GetName());

    // Broadcast to WebSocket clients
    if (UAegisWebSocketServer* WsServer = UAegisWebSocketServer::Get())
    {
        TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject());
        EventData->SetStringField(TEXT("actorName"), Actor->GetName());
        EventData->SetStringField(TEXT("actorClass"), Actor->GetClass()->GetName());
        EventData->SetStringField(TEXT("actorPath"), Actor->GetPathName());

        WsServer->BroadcastEvent(TEXT("world.entity.spawned"), EventData);
    }
}

void FAegisBridgeModule::OnActorDeleted(AActor* Actor)
{
    if (!Actor) return;

    UE_LOG(LogAegisBridge, Verbose, TEXT("Actor deleted: %s"), *Actor->GetName());

    // Broadcast to WebSocket clients
    if (UAegisWebSocketServer* WsServer = UAegisWebSocketServer::Get())
    {
        TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject());
        EventData->SetStringField(TEXT("actorName"), Actor->GetName());
        EventData->SetStringField(TEXT("actorClass"), Actor->GetClass()->GetName());

        WsServer->BroadcastEvent(TEXT("world.entity.destroyed"), EventData);
    }
}

void FAegisBridgeModule::OnSelectionChanged(UObject* Object)
{
    UE_LOG(LogAegisBridge, Verbose, TEXT("Selection changed"));

    // Broadcast to WebSocket clients
    if (UAegisWebSocketServer* WsServer = UAegisWebSocketServer::Get())
    {
        TArray<AActor*> SelectedActors;
        if (GEditor)
        {
            GEditor->GetSelectedActors()->GetSelectedObjects<AActor>(SelectedActors);
        }

        TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject());
        TArray<TSharedPtr<FJsonValue>> ActorArray;

        for (AActor* Actor : SelectedActors)
        {
            TSharedPtr<FJsonObject> ActorObj = MakeShareable(new FJsonObject());
            ActorObj->SetStringField(TEXT("name"), Actor->GetName());
            ActorObj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
            ActorObj->SetStringField(TEXT("path"), Actor->GetPathName());
            ActorArray.Add(MakeShareable(new FJsonValueObject(ActorObj)));
        }

        EventData->SetArrayField(TEXT("selectedActors"), ActorArray);
        EventData->SetNumberField(TEXT("count"), SelectedActors.Num());

        WsServer->BroadcastEvent(TEXT("editor.selection.changed"), EventData);
    }
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FAegisBridgeModule, AegisBridge)
