// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "IWebSocketServer.h"
#include "AegisWebSocketServer.generated.h"

/**
 * AEGIS WebSocket Server
 * Handles real-time bidirectional communication with MCP server
 */
UCLASS()
class AEGISBRIDGE_API UAegisWebSocketServer : public UObject
{
    GENERATED_BODY()

public:
    /** Get singleton instance */
    static UAegisWebSocketServer* Get();

    /** Initialize the WebSocket server */
    void Initialize(int32 Port = 30020);

    /** Shutdown the WebSocket server */
    void Shutdown();

    /** Broadcast an event to all connected clients */
    void BroadcastEvent(const FString& EventType, const TSharedPtr<FJsonObject>& Data);

    /** Send a message to a specific client */
    void SendToClient(const FString& ClientId, const FString& Message);

    /** Check if server is running */
    bool IsRunning() const { return bIsRunning; }

    /** Get connected client count */
    int32 GetClientCount() const;

protected:
    /** Handle new client connection */
    void OnClientConnected(const FString& ClientId);

    /** Handle client disconnection */
    void OnClientDisconnected(const FString& ClientId);

    /** Handle incoming message */
    void OnMessageReceived(const FString& ClientId, const FString& Message);

private:
    /** WebSocket server instance */
    TSharedPtr<IWebSocketServer> WebSocketServer;

    /** Connected clients */
    TMap<FString, bool> ConnectedClients;

    /** Server running state */
    bool bIsRunning = false;

    /** Singleton instance */
    static UAegisWebSocketServer* Instance;
};
