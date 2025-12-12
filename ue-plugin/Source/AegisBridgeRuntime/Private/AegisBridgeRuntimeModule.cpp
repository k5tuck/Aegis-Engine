// Copyright AEGIS Team. All Rights Reserved.

#include "AegisBridgeRuntimeModule.h"

DEFINE_LOG_CATEGORY(LogAegisBridgeRuntime);

void FAegisBridgeRuntimeModule::StartupModule()
{
    UE_LOG(LogAegisBridgeRuntime, Log, TEXT("AEGIS Bridge Runtime Module starting up..."));
}

void FAegisBridgeRuntimeModule::ShutdownModule()
{
    UE_LOG(LogAegisBridgeRuntime, Log, TEXT("AEGIS Bridge Runtime Module shutting down..."));
}

IMPLEMENT_MODULE(FAegisBridgeRuntimeModule, AegisBridgeRuntime)
