// Copyright AEGIS Team. All Rights Reserved.

#include "AegisWebSocketServer.h"
#include "AegisBridgeModule.h"
#include "WebSocketsModule.h"
#include "IWebSocketServer.h"
#include "Json.h"

UAegisWebSocketServer* UAegisWebSocketServer::Instance = nullptr;

UAegisWebSocketServer* UAegisWebSocketServer::Get()
{
    if (!Instance)
    {
        Instance = NewObject<UAegisWebSocketServer>();
        Instance->AddToRoot(); // Prevent garbage collection
    }
    return Instance;
}

void UAegisWebSocketServer::Initialize(int32 Port)
{
    if (bIsRunning)
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("WebSocket server already running"));
        return;
    }

    UE_LOG(LogAegisBridge, Log, TEXT("Initializing AEGIS WebSocket server on port %d"), Port);

    // Note: This is a simplified implementation
    // Production would integrate with UE's WebSocket server or Remote Control WebSocket

    bIsRunning = true;
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS WebSocket server initialized"));
}

void UAegisWebSocketServer::Shutdown()
{
    if (!bIsRunning)
    {
        return;
    }

    UE_LOG(LogAegisBridge, Log, TEXT("Shutting down AEGIS WebSocket server"));

    ConnectedClients.Empty();
    bIsRunning = false;
}

void UAegisWebSocketServer::BroadcastEvent(const FString& EventType, const TSharedPtr<FJsonObject>& Data)
{
    if (!bIsRunning)
    {
        return;
    }

    // Create event message
    TSharedPtr<FJsonObject> EventMessage = MakeShareable(new FJsonObject());
    EventMessage->SetStringField(TEXT("type"), TEXT("event"));
    EventMessage->SetStringField(TEXT("event"), EventType);
    EventMessage->SetNumberField(TEXT("timestamp"), FDateTime::UtcNow().ToUnixTimestamp());

    if (Data.IsValid())
    {
        EventMessage->SetObjectField(TEXT("data"), Data);
    }

    // Serialize to string
    FString MessageString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&MessageString);
    FJsonSerializer::Serialize(EventMessage.ToSharedRef(), Writer);

    UE_LOG(LogAegisBridge, Verbose, TEXT("Broadcasting event: %s"), *EventType);

    // In production, this would send to all connected WebSocket clients
    // For now, we log the event
    for (const auto& Client : ConnectedClients)
    {
        SendToClient(Client.Key, MessageString);
    }
}

void UAegisWebSocketServer::SendToClient(const FString& ClientId, const FString& Message)
{
    if (!ConnectedClients.Contains(ClientId))
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("Client not found: %s"), *ClientId);
        return;
    }

    // In production, this would send via WebSocket
    UE_LOG(LogAegisBridge, Verbose, TEXT("Sending to client %s: %s"), *ClientId, *Message);
}

int32 UAegisWebSocketServer::GetClientCount() const
{
    return ConnectedClients.Num();
}

void UAegisWebSocketServer::OnClientConnected(const FString& ClientId)
{
    UE_LOG(LogAegisBridge, Log, TEXT("Client connected: %s"), *ClientId);
    ConnectedClients.Add(ClientId, true);

    // Update bridge connection status
    if (FAegisBridgeModule::IsAvailable())
    {
        FAegisBridgeModule::Get().SetBridgeConnected(true);
    }

    // Send welcome message
    TSharedPtr<FJsonObject> WelcomeData = MakeShareable(new FJsonObject());
    WelcomeData->SetStringField(TEXT("version"), TEXT("1.0.0"));
    WelcomeData->SetStringField(TEXT("server"), TEXT("AegisBridge"));

    BroadcastEvent(TEXT("connection.established"), WelcomeData);
}

void UAegisWebSocketServer::OnClientDisconnected(const FString& ClientId)
{
    UE_LOG(LogAegisBridge, Log, TEXT("Client disconnected: %s"), *ClientId);
    ConnectedClients.Remove(ClientId);

    // Update bridge connection status
    if (FAegisBridgeModule::IsAvailable() && ConnectedClients.Num() == 0)
    {
        FAegisBridgeModule::Get().SetBridgeConnected(false);
    }
}

void UAegisWebSocketServer::OnMessageReceived(const FString& ClientId, const FString& Message)
{
    UE_LOG(LogAegisBridge, Verbose, TEXT("Message from %s: %s"), *ClientId, *Message);

    // Parse message
    TSharedPtr<FJsonObject> JsonMessage;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);

    if (!FJsonSerializer::Deserialize(Reader, JsonMessage) || !JsonMessage.IsValid())
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("Failed to parse message from client %s"), *ClientId);
        return;
    }

    // Handle message based on type
    FString MessageType = JsonMessage->GetStringField(TEXT("type"));

    if (MessageType == TEXT("subscribe"))
    {
        // Handle event subscription
        FString EventName = JsonMessage->GetStringField(TEXT("event"));
        UE_LOG(LogAegisBridge, Log, TEXT("Client %s subscribed to event: %s"), *ClientId, *EventName);
    }
    else if (MessageType == TEXT("unsubscribe"))
    {
        // Handle event unsubscription
        FString EventName = JsonMessage->GetStringField(TEXT("event"));
        UE_LOG(LogAegisBridge, Log, TEXT("Client %s unsubscribed from event: %s"), *ClientId, *EventName);
    }
    else if (MessageType == TEXT("ping"))
    {
        // Respond with pong
        TSharedPtr<FJsonObject> PongMessage = MakeShareable(new FJsonObject());
        PongMessage->SetStringField(TEXT("type"), TEXT("pong"));
        PongMessage->SetNumberField(TEXT("timestamp"), FDateTime::UtcNow().ToUnixTimestamp());

        FString PongString;
        TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&PongString);
        FJsonSerializer::Serialize(PongMessage.ToSharedRef(), Writer);

        SendToClient(ClientId, PongString);
    }
}
