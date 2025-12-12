// Copyright AEGIS Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/EditorSubsystem.h"
#include "AegisSeedSubsystem.generated.h"

/**
 * GUID Entry for tracking entities
 */
USTRUCT(BlueprintType)
struct FAegisGUIDEntry
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString GUID;

    UPROPERTY(BlueprintReadOnly)
    FString EntityPath;

    UPROPERTY(BlueprintReadOnly)
    FString EntityType;

    UPROPERTY(BlueprintReadOnly)
    FString EntityName;

    UPROPERTY(BlueprintReadOnly)
    FString Metadata;

    UPROPERTY(BlueprintReadOnly)
    FDateTime CreatedAt;

    UPROPERTY(BlueprintReadOnly)
    int32 Version = 1;
};

/**
 * World snapshot data
 */
USTRUCT(BlueprintType)
struct FAegisWorldSnapshot
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString SnapshotId;

    UPROPERTY(BlueprintReadOnly)
    FString Name;

    UPROPERTY(BlueprintReadOnly)
    FString Description;

    UPROPERTY(BlueprintReadOnly)
    FDateTime Timestamp;

    UPROPERTY(BlueprintReadOnly)
    FString Checksum;

    UPROPERTY(BlueprintReadOnly)
    int32 EntityCount = 0;
};

/**
 * AEGIS Seed Protocol Subsystem
 * Handles deterministic GUID generation and world state synchronization
 */
UCLASS()
class AEGISBRIDGE_API UAegisSeedSubsystem : public UEditorSubsystem
{
    GENERATED_BODY()

public:
    /** Get singleton instance */
    static UAegisSeedSubsystem* Get();

    //~ Begin UEditorSubsystem Interface
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    //~ End UEditorSubsystem Interface

    // =========================================================================
    // GUID Operations
    // =========================================================================

    /** Generate a deterministic GUID */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString GenerateGUID(const FString& Namespace, const FString& EntityType, const FString& Seed, int32 Counter, const FString& EntityName);

    /** Register a GUID with an entity */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool RegisterGUID(const FString& GUID, const FString& EntityPath, const FString& EntityType, const FString& Metadata);

    /** Resolve a GUID to its entity */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool ResolveGUID(const FString& GUID, FAegisGUIDEntry& OutEntry);

    /** Verify a GUID entity still exists */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool VerifyGUIDEntity(const FString& GUID, const FString& EntityPath);

    /** Clear the GUID registry */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    void ClearGUIDRegistry();

    /** Set the global seed */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    void SetGlobalSeed(const FString& Seed, bool bResetCounter);

    /** Get the global seed */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString GetGlobalSeed() const { return GlobalSeed; }

    /** Get the current counter */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    int32 GetSeedCounter() const { return SeedCounter; }

    // =========================================================================
    // State Capture Operations
    // =========================================================================

    /** Capture all actors in the world */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString CaptureAllActors(const TArray<FString>& ClassFilter, const TArray<FString>& TagFilter);

    /** Capture landscape data */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString CaptureLandscape(bool bIncludeHeightmap, bool bIncludeLayers);

    /** Capture foliage data */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString CaptureFoliage(bool bIncludeInstances);

    /** Store a snapshot */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool StoreSnapshot(const FString& SnapshotId, const FString& SnapshotData);

    /** Load a snapshot */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString LoadSnapshot(const FString& SnapshotId);

    /** List all snapshots */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    TArray<FAegisWorldSnapshot> ListSnapshots();

    /** Delete a snapshot */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool DeleteSnapshot(const FString& SnapshotId);

    /** Export snapshot to file */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool ExportSnapshot(const FString& SnapshotId, const FString& SnapshotData, const FString& OutputPath, bool bCompress);

    /** Import snapshot from file */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString ImportSnapshot(const FString& InputPath);

    // =========================================================================
    // State Restoration Operations
    // =========================================================================

    /** Restore world state from snapshot */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    bool RestoreWorldState(const FString& SnapshotId, const FString& Entities, const FString& MergeMode, bool bPreserveGUIDs);

    /** Synchronize world state with target */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString SyncWorldState(const FString& TargetSnapshotId, const FString& TargetEntities, bool bCaptureCurrentFirst, const FString& ConflictResolution, bool bDryRun);

    /** Merge world states */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString MergeWorldStates(const FString& SourceSnapshotId, const FString& TargetSnapshotId, const FString& Changes, const FString& ConflictResolution, bool bPreserveSourceGUIDs);

    /** Apply a diff to the world */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString ApplyDiff(const FString& DiffId, const FString& Changes, const FString& ConflictResolution);

    // =========================================================================
    // Level Info
    // =========================================================================

    /** Get current level information */
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed")
    FString GetCurrentLevelInfo();

private:
    /** GUID Registry */
    TMap<FString, FAegisGUIDEntry> GUIDRegistry;

    /** Path to GUID mapping */
    TMap<FString, FString> PathToGUIDMap;

    /** Snapshot storage */
    TMap<FString, FString> SnapshotStorage;

    /** Global seed for GUID generation */
    FString GlobalSeed;

    /** Counter for GUID generation */
    int32 SeedCounter = 0;

    /** Get namespace code */
    FString GetNamespaceCode(const FString& Namespace);

    /** Compute SHA256 hash */
    FString ComputeSHA256(const FString& Input);
};
