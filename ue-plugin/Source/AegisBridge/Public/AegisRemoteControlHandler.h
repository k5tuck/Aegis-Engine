// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "AegisRemoteControlHandler.generated.h"

/**
 * AEGIS Remote Control Handler
 * Handles Remote Control API requests from MCP server
 */
UCLASS()
class AEGISBRIDGE_API UAegisRemoteControlHandler : public UObject
{
    GENERATED_BODY()

public:
    /** Get singleton instance */
    static UAegisRemoteControlHandler* Get();

    /** Initialize the handler */
    void Initialize();

    /** Shutdown the handler */
    void Shutdown();

    /** Handle incoming request */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|RemoteControl")
    FString HandleRequest(const FString& ObjectPath, const FString& FunctionName, const FString& Parameters);

    /** Check if handler is ready */
    bool IsReady() const { return bIsReady; }

protected:
    /** Register AEGIS function handlers */
    void RegisterFunctionHandlers();

    /** Unregister AEGIS function handlers */
    void UnregisterFunctionHandlers();

private:
    bool bIsReady = false;

    /** Singleton instance */
    static UAegisRemoteControlHandler* Instance;
};
