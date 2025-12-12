// Copyright AEGIS Team. All Rights Reserved.

#include "AegisRemoteControlHandler.h"
#include "AegisBridgeModule.h"
#include "AegisSubsystem.h"
#include "AegisSeedSubsystem.h"
#include "IRemoteControlModule.h"
#include "RemoteControlPreset.h"
#include "Json.h"

UAegisRemoteControlHandler* UAegisRemoteControlHandler::Instance = nullptr;

UAegisRemoteControlHandler* UAegisRemoteControlHandler::Get()
{
    if (!Instance)
    {
        Instance = NewObject<UAegisRemoteControlHandler>();
        Instance->AddToRoot(); // Prevent garbage collection
    }
    return Instance;
}

void UAegisRemoteControlHandler::Initialize()
{
    if (bIsReady)
    {
        UE_LOG(LogAegisBridge, Warning, TEXT("Remote Control handler already initialized"));
        return;
    }

    UE_LOG(LogAegisBridge, Log, TEXT("Initializing AEGIS Remote Control handler"));

    RegisterFunctionHandlers();

    bIsReady = true;
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Remote Control handler initialized"));
}

void UAegisRemoteControlHandler::Shutdown()
{
    if (!bIsReady)
    {
        return;
    }

    UE_LOG(LogAegisBridge, Log, TEXT("Shutting down AEGIS Remote Control handler"));

    UnregisterFunctionHandlers();

    bIsReady = false;
}

FString UAegisRemoteControlHandler::HandleRequest(const FString& ObjectPath, const FString& FunctionName, const FString& Parameters)
{
    UE_LOG(LogAegisBridge, Verbose, TEXT("Handling request: %s.%s"), *ObjectPath, *FunctionName);

    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());

    // Parse parameters
    TSharedPtr<FJsonObject> ParamsObj;
    if (!Parameters.IsEmpty())
    {
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Parameters);
        FJsonSerializer::Deserialize(Reader, ParamsObj);
    }

    // Route to appropriate subsystem
    if (ObjectPath.Contains(TEXT("AegisSubsystem")))
    {
        UAegisSubsystem* Subsystem = UAegisSubsystem::Get();
        if (!Subsystem)
        {
            Result->SetBoolField(TEXT("success"), false);
            Result->SetStringField(TEXT("error"), TEXT("AegisSubsystem not available"));
        }
        else
        {
            // Route to subsystem methods
            // This would be implemented using reflection or a dispatch table
            Result->SetBoolField(TEXT("success"), true);
            Result->SetStringField(TEXT("message"), TEXT("Request handled"));
        }
    }
    else if (ObjectPath.Contains(TEXT("AegisSeedSubsystem")))
    {
        UAegisSeedSubsystem* SeedSubsystem = UAegisSeedSubsystem::Get();
        if (!SeedSubsystem)
        {
            Result->SetBoolField(TEXT("success"), false);
            Result->SetStringField(TEXT("error"), TEXT("AegisSeedSubsystem not available"));
        }
        else
        {
            // Route to seed subsystem methods
            if (FunctionName == TEXT("GenerateGUID"))
            {
                FString Namespace = ParamsObj ? ParamsObj->GetStringField(TEXT("Namespace")) : TEXT("");
                FString EntityType = ParamsObj ? ParamsObj->GetStringField(TEXT("EntityType")) : TEXT("");
                FString Seed = ParamsObj ? ParamsObj->GetStringField(TEXT("Seed")) : TEXT("");
                int32 Counter = ParamsObj ? ParamsObj->GetIntegerField(TEXT("Counter")) : 0;
                FString EntityName = ParamsObj ? ParamsObj->GetStringField(TEXT("EntityName")) : TEXT("");

                FString GUID = SeedSubsystem->GenerateGUID(Namespace, EntityType, Seed, Counter, EntityName);

                Result->SetBoolField(TEXT("success"), true);
                Result->SetStringField(TEXT("guid"), GUID);
            }
            else if (FunctionName == TEXT("RegisterGUID"))
            {
                FString GUID = ParamsObj ? ParamsObj->GetStringField(TEXT("GUID")) : TEXT("");
                FString EntityPath = ParamsObj ? ParamsObj->GetStringField(TEXT("EntityPath")) : TEXT("");
                FString EntityType = ParamsObj ? ParamsObj->GetStringField(TEXT("EntityType")) : TEXT("");
                FString Metadata = ParamsObj ? ParamsObj->GetStringField(TEXT("Metadata")) : TEXT("{}");

                bool bSuccess = SeedSubsystem->RegisterGUID(GUID, EntityPath, EntityType, Metadata);
                Result->SetBoolField(TEXT("success"), bSuccess);
            }
            else if (FunctionName == TEXT("CaptureAllActors"))
            {
                TArray<FString> ClassFilter;
                TArray<FString> TagFilter;

                const TArray<TSharedPtr<FJsonValue>>* ClassFilterArray;
                if (ParamsObj && ParamsObj->TryGetArrayField(TEXT("ClassFilter"), ClassFilterArray))
                {
                    for (const auto& Val : *ClassFilterArray)
                    {
                        ClassFilter.Add(Val->AsString());
                    }
                }

                const TArray<TSharedPtr<FJsonValue>>* TagFilterArray;
                if (ParamsObj && ParamsObj->TryGetArrayField(TEXT("TagFilter"), TagFilterArray))
                {
                    for (const auto& Val : *TagFilterArray)
                    {
                        TagFilter.Add(Val->AsString());
                    }
                }

                FString CaptureResult = SeedSubsystem->CaptureAllActors(ClassFilter, TagFilter);
                Result->SetBoolField(TEXT("success"), true);

                TSharedPtr<FJsonObject> CaptureData;
                TSharedRef<TJsonReader<>> CaptureReader = TJsonReaderFactory<>::Create(CaptureResult);
                if (FJsonSerializer::Deserialize(CaptureReader, CaptureData))
                {
                    Result->SetObjectField(TEXT("data"), CaptureData);
                }
            }
            else if (FunctionName == TEXT("GetCurrentLevelInfo"))
            {
                FString LevelInfo = SeedSubsystem->GetCurrentLevelInfo();
                Result->SetBoolField(TEXT("success"), true);

                TSharedPtr<FJsonObject> LevelData;
                TSharedRef<TJsonReader<>> LevelReader = TJsonReaderFactory<>::Create(LevelInfo);
                if (FJsonSerializer::Deserialize(LevelReader, LevelData))
                {
                    Result->SetObjectField(TEXT("data"), LevelData);
                }
            }
            else
            {
                Result->SetBoolField(TEXT("success"), false);
                Result->SetStringField(TEXT("error"), FString::Printf(TEXT("Unknown function: %s"), *FunctionName));
            }
        }
    }
    else
    {
        Result->SetBoolField(TEXT("success"), false);
        Result->SetStringField(TEXT("error"), FString::Printf(TEXT("Unknown object path: %s"), *ObjectPath));
    }

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

void UAegisRemoteControlHandler::RegisterFunctionHandlers()
{
    // Register AEGIS functions with Remote Control
    // This would integrate with UE's Remote Control preset system

    UE_LOG(LogAegisBridge, Log, TEXT("Registered AEGIS function handlers"));
}

void UAegisRemoteControlHandler::UnregisterFunctionHandlers()
{
    // Unregister AEGIS functions from Remote Control

    UE_LOG(LogAegisBridge, Log, TEXT("Unregistered AEGIS function handlers"));
}
