// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

DECLARE_LOG_CATEGORY_EXTERN(LogAegisBridgeRuntime, Log, All);

/**
 * AEGIS Bridge Runtime Module
 * Runtime module for AI-powered game functionality
 */
class FAegisBridgeRuntimeModule : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

    static inline FAegisBridgeRuntimeModule& Get()
    {
        return FModuleManager::LoadModuleChecked<FAegisBridgeRuntimeModule>("AegisBridgeRuntime");
    }

    static inline bool IsAvailable()
    {
        return FModuleManager::Get().IsModuleLoaded("AegisBridgeRuntime");
    }
};
