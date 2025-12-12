// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/EditorSubsystem.h"
#include "AegisSubsystem.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogAegisSubsystem, Log, All);

/**
 * Command execution result
 */
USTRUCT(BlueprintType)
struct FAegisCommandResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly)
    FString Message;

    UPROPERTY(BlueprintReadOnly)
    FString Data;

    UPROPERTY(BlueprintReadOnly)
    FString ErrorCode;
};

/**
 * Actor spawn parameters
 */
USTRUCT(BlueprintType)
struct FAegisSpawnParams
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite)
    FString ClassName;

    UPROPERTY(BlueprintReadWrite)
    FString ActorName;

    UPROPERTY(BlueprintReadWrite)
    FVector Location = FVector::ZeroVector;

    UPROPERTY(BlueprintReadWrite)
    FRotator Rotation = FRotator::ZeroRotator;

    UPROPERTY(BlueprintReadWrite)
    FVector Scale = FVector::OneVector;

    UPROPERTY(BlueprintReadWrite)
    TMap<FString, FString> Properties;
};

/**
 * AEGIS Editor Subsystem
 * Core subsystem for AI-powered Unreal Engine operations
 */
UCLASS()
class AEGISBRIDGE_API UAegisSubsystem : public UEditorSubsystem
{
    GENERATED_BODY()

public:
    /** Get singleton instance */
    static UAegisSubsystem* Get();

    //~ Begin UEditorSubsystem Interface
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    //~ End UEditorSubsystem Interface

    // =========================================================================
    // Actor Operations
    // =========================================================================

    /** Spawn an actor with the given parameters */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult SpawnActor(const FAegisSpawnParams& Params);

    /** Delete an actor by path */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult DeleteActor(const FString& ActorPath);

    /** Modify actor properties */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult ModifyActor(const FString& ActorPath, const TMap<FString, FString>& Properties);

    /** Query actors by filter */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult QueryActors(const FString& ClassFilter, const FString& NameFilter, const TArray<FString>& Tags);

    /** Get actor information */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult GetActorInfo(const FString& ActorPath, bool bIncludeComponents, bool bIncludeProperties);

    /** Duplicate an actor */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult DuplicateActor(const FString& ActorPath, const FVector& Offset);

    /** Select actors in editor */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Actors")
    FAegisCommandResult SelectActors(const TArray<FString>& ActorPaths, bool bAddToSelection);

    // =========================================================================
    // Blueprint Operations
    // =========================================================================

    /** Create a new blueprint */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Blueprints")
    FAegisCommandResult CreateBlueprint(const FString& BlueprintName, const FString& ParentClass, const FString& Path);

    /** Compile a blueprint */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Blueprints")
    FAegisCommandResult CompileBlueprint(const FString& BlueprintPath);

    /** Add component to blueprint */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Blueprints")
    FAegisCommandResult AddBlueprintComponent(const FString& BlueprintPath, const FString& ComponentClass, const FString& ComponentName);

    /** Add variable to blueprint */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Blueprints")
    FAegisCommandResult AddBlueprintVariable(const FString& BlueprintPath, const FString& VariableName, const FString& VariableType);

    // =========================================================================
    // Asset Operations
    // =========================================================================

    /** Search for assets */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Assets")
    FAegisCommandResult SearchAssets(const FString& SearchQuery, const FString& AssetType, const FString& Path);

    /** Load an asset */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Assets")
    FAegisCommandResult LoadAsset(const FString& AssetPath);

    /** Import an asset */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Assets")
    FAegisCommandResult ImportAsset(const FString& SourcePath, const FString& DestinationPath);

    /** Export an asset */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Assets")
    FAegisCommandResult ExportAsset(const FString& AssetPath, const FString& ExportPath);

    // =========================================================================
    // Level Operations
    // =========================================================================

    /** Load a level */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Level")
    FAegisCommandResult LoadLevel(const FString& LevelPath);

    /** Save the current level */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Level")
    FAegisCommandResult SaveLevel();

    /** Create a new level */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Level")
    FAegisCommandResult CreateLevel(const FString& LevelName, const FString& TemplateName);

    /** Get current level information */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Level")
    FAegisCommandResult GetLevelInfo();

    // =========================================================================
    // Editor Operations
    // =========================================================================

    /** Execute editor command */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Editor")
    FAegisCommandResult ExecuteEditorCommand(const FString& Command);

    /** Undo last operation */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Editor")
    FAegisCommandResult Undo();

    /** Redo last undone operation */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Editor")
    FAegisCommandResult Redo();

    /** Get current selection */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Editor")
    FAegisCommandResult GetSelection();

    /** Focus viewport on actor */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Editor")
    FAegisCommandResult FocusActor(const FString& ActorPath);

    // =========================================================================
    // Context Operations
    // =========================================================================

    /** Get current editor context for AI */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Context")
    FAegisCommandResult GetEditorContext();

    /** Get project information */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Context")
    FAegisCommandResult GetProjectInfo();

private:
    /** Find actor by path */
    AActor* FindActorByPath(const FString& ActorPath);

    /** Convert actor to JSON */
    TSharedPtr<FJsonObject> ActorToJson(AActor* Actor, bool bIncludeComponents, bool bIncludeProperties);

    /** Create success result */
    FAegisCommandResult MakeSuccess(const FString& Message, const TSharedPtr<FJsonObject>& Data = nullptr);

    /** Create error result */
    FAegisCommandResult MakeError(const FString& Message, const FString& ErrorCode = TEXT(""));
};
