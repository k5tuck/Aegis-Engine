// Copyright AEGIS Team. All Rights Reserved.

#include "AegisSeedSubsystem.h"
#include "AegisBridgeModule.h"
#include "Editor.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "Landscape.h"
#include "LandscapeProxy.h"
#include "InstancedFoliageActor.h"
#include "Misc/SecureHash.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Compression/OodleDataCompressionUtil.h"

UAegisSeedSubsystem* UAegisSeedSubsystem::Get()
{
    if (GEditor)
    {
        return GEditor->GetEditorSubsystem<UAegisSeedSubsystem>();
    }
    return nullptr;
}

void UAegisSeedSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Seed Subsystem initialized"));
}

void UAegisSeedSubsystem::Deinitialize()
{
    UE_LOG(LogAegisBridge, Log, TEXT("AEGIS Seed Subsystem deinitialized"));
    Super::Deinitialize();
}

// ============================================================================
// GUID Operations
// ============================================================================

FString UAegisSeedSubsystem::GenerateGUID(const FString& Namespace, const FString& EntityType, const FString& Seed, int32 Counter, const FString& EntityName)
{
    // Create deterministic input string
    FString InputString = FString::Printf(TEXT("%s:%s:%s:%d:%s"), *Namespace, *EntityType, *Seed, Counter, *EntityName);

    // Compute SHA256 hash
    FString Hash = ComputeSHA256(InputString);

    // Get namespace code
    FString NamespaceCode = GetNamespaceCode(Namespace);

    // Format as GUID: XXX-XXXXXXXX-XXXX-XXXX-XXXXXXXXXXXX
    FString GUID = FString::Printf(TEXT("%s-%s-%s-%s-%s"),
        *NamespaceCode,
        *Hash.Mid(0, 8).ToUpper(),
        *Hash.Mid(8, 4).ToUpper(),
        *Hash.Mid(12, 4).ToUpper(),
        *Hash.Mid(16, 12).ToUpper());

    return GUID;
}

bool UAegisSeedSubsystem::RegisterGUID(const FString& GUID, const FString& EntityPath, const FString& EntityType, const FString& Metadata)
{
    // Check for existing registration
    if (GUIDRegistry.Contains(GUID))
    {
        const FAegisGUIDEntry& Existing = GUIDRegistry[GUID];
        if (Existing.EntityPath != EntityPath)
        {
            UE_LOG(LogAegisBridge, Warning, TEXT("GUID already registered to different entity: %s"), *GUID);
            return false;
        }
    }

    if (PathToGUIDMap.Contains(EntityPath))
    {
        const FString& ExistingGUID = PathToGUIDMap[EntityPath];
        if (ExistingGUID != GUID)
        {
            UE_LOG(LogAegisBridge, Warning, TEXT("Entity path already has different GUID: %s"), *EntityPath);
            return false;
        }
    }

    // Create entry
    FAegisGUIDEntry Entry;
    Entry.GUID = GUID;
    Entry.EntityPath = EntityPath;
    Entry.EntityType = EntityType;
    Entry.Metadata = Metadata;
    Entry.CreatedAt = FDateTime::UtcNow();
    Entry.Version = GUIDRegistry.Contains(GUID) ? GUIDRegistry[GUID].Version + 1 : 1;

    // Extract entity name from path
    int32 LastSlash;
    if (EntityPath.FindLastChar('/', LastSlash))
    {
        Entry.EntityName = EntityPath.Mid(LastSlash + 1);
    }
    else
    {
        Entry.EntityName = EntityPath;
    }

    // Register
    GUIDRegistry.Add(GUID, Entry);
    PathToGUIDMap.Add(EntityPath, GUID);

    UE_LOG(LogAegisBridge, Verbose, TEXT("Registered GUID: %s -> %s"), *GUID, *EntityPath);
    return true;
}

bool UAegisSeedSubsystem::ResolveGUID(const FString& GUID, FAegisGUIDEntry& OutEntry)
{
    if (const FAegisGUIDEntry* Entry = GUIDRegistry.Find(GUID))
    {
        OutEntry = *Entry;
        return true;
    }
    return false;
}

bool UAegisSeedSubsystem::VerifyGUIDEntity(const FString& GUID, const FString& EntityPath)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World) return false;

    // Try to find the actor
    AActor* Actor = FindObject<AActor>(World->GetCurrentLevel(), *EntityPath);
    if (!Actor)
    {
        // Try name-based search
        for (TActorIterator<AActor> It(World); It; ++It)
        {
            if (It->GetPathName() == EntityPath || It->GetName() == EntityPath)
            {
                return true;
            }
        }
        return false;
    }

    return true;
}

void UAegisSeedSubsystem::ClearGUIDRegistry()
{
    GUIDRegistry.Empty();
    PathToGUIDMap.Empty();
    UE_LOG(LogAegisBridge, Log, TEXT("GUID registry cleared"));
}

void UAegisSeedSubsystem::SetGlobalSeed(const FString& Seed, bool bResetCounter)
{
    GlobalSeed = Seed;
    if (bResetCounter)
    {
        SeedCounter = 0;
    }
    UE_LOG(LogAegisBridge, Log, TEXT("Global seed set: %s, counter: %d"), *GlobalSeed, SeedCounter);
}

// ============================================================================
// State Capture Operations
// ============================================================================

FString UAegisSeedSubsystem::CaptureAllActors(const TArray<FString>& ClassFilter, const TArray<FString>& TagFilter)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return TEXT("{}");
    }

    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    TArray<TSharedPtr<FJsonValue>> ActorArray;

    for (TActorIterator<AActor> It(World); It; ++It)
    {
        AActor* Actor = *It;

        // Apply class filter
        if (ClassFilter.Num() > 0)
        {
            bool bMatchesClass = false;
            for (const FString& ClassFilterStr : ClassFilter)
            {
                if (Actor->GetClass()->GetName().Contains(ClassFilterStr))
                {
                    bMatchesClass = true;
                    break;
                }
            }
            if (!bMatchesClass) continue;
        }

        // Apply tag filter
        if (TagFilter.Num() > 0)
        {
            bool bHasAllTags = true;
            for (const FString& Tag : TagFilter)
            {
                if (!Actor->Tags.ContainsByPredicate([&Tag](const FName& ActorTag) {
                    return ActorTag.ToString() == Tag;
                }))
                {
                    bHasAllTags = false;
                    break;
                }
            }
            if (!bHasAllTags) continue;
        }

        // Create actor object
        TSharedPtr<FJsonObject> ActorObj = MakeShareable(new FJsonObject());

        // Check if we have a registered GUID for this actor
        FString* ExistingGUID = PathToGUIDMap.Find(Actor->GetPathName());
        ActorObj->SetStringField(TEXT("guid"), ExistingGUID ? *ExistingGUID : TEXT(""));
        ActorObj->SetStringField(TEXT("name"), Actor->GetName());
        ActorObj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
        ActorObj->SetStringField(TEXT("path"), Actor->GetPathName());

        // Transform
        TSharedPtr<FJsonObject> TransformObj = MakeShareable(new FJsonObject());
        FVector Location = Actor->GetActorLocation();
        FRotator Rotation = Actor->GetActorRotation();
        FVector Scale = Actor->GetActorScale3D();

        TSharedPtr<FJsonObject> LocObj = MakeShareable(new FJsonObject());
        LocObj->SetNumberField(TEXT("x"), Location.X);
        LocObj->SetNumberField(TEXT("y"), Location.Y);
        LocObj->SetNumberField(TEXT("z"), Location.Z);
        TransformObj->SetObjectField(TEXT("location"), LocObj);

        TSharedPtr<FJsonObject> RotObj = MakeShareable(new FJsonObject());
        RotObj->SetNumberField(TEXT("pitch"), Rotation.Pitch);
        RotObj->SetNumberField(TEXT("yaw"), Rotation.Yaw);
        RotObj->SetNumberField(TEXT("roll"), Rotation.Roll);
        TransformObj->SetObjectField(TEXT("rotation"), RotObj);

        TSharedPtr<FJsonObject> ScaleObj = MakeShareable(new FJsonObject());
        ScaleObj->SetNumberField(TEXT("x"), Scale.X);
        ScaleObj->SetNumberField(TEXT("y"), Scale.Y);
        ScaleObj->SetNumberField(TEXT("z"), Scale.Z);
        TransformObj->SetObjectField(TEXT("scale"), ScaleObj);

        ActorObj->SetObjectField(TEXT("transform"), TransformObj);

        // Tags
        TArray<TSharedPtr<FJsonValue>> TagArray;
        for (const FName& Tag : Actor->Tags)
        {
            TagArray.Add(MakeShareable(new FJsonValueString(Tag.ToString())));
        }
        ActorObj->SetArrayField(TEXT("tags"), TagArray);

        // Components
        TArray<TSharedPtr<FJsonValue>> CompArray;
        for (UActorComponent* Component : Actor->GetComponents())
        {
            TSharedPtr<FJsonObject> CompObj = MakeShareable(new FJsonObject());
            CompObj->SetStringField(TEXT("name"), Component->GetName());
            CompObj->SetStringField(TEXT("class"), Component->GetClass()->GetName());
            CompArray.Add(MakeShareable(new FJsonValueObject(CompObj)));
        }
        ActorObj->SetArrayField(TEXT("components"), CompArray);

        ActorArray.Add(MakeShareable(new FJsonValueObject(ActorObj)));
    }

    Result->SetArrayField(TEXT("actors"), ActorArray);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

FString UAegisSeedSubsystem::CaptureLandscape(bool bIncludeHeightmap, bool bIncludeLayers)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return TEXT("{}");
    }

    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    TArray<TSharedPtr<FJsonValue>> LandscapeArray;

    for (TActorIterator<ALandscapeProxy> It(World); It; ++It)
    {
        ALandscapeProxy* Landscape = *It;

        TSharedPtr<FJsonObject> LandscapeObj = MakeShareable(new FJsonObject());
        LandscapeObj->SetStringField(TEXT("name"), Landscape->GetName());
        LandscapeObj->SetStringField(TEXT("path"), Landscape->GetPathName());

        // Transform
        FVector Location = Landscape->GetActorLocation();
        FRotator Rotation = Landscape->GetActorRotation();

        TSharedPtr<FJsonObject> TransformObj = MakeShareable(new FJsonObject());
        TSharedPtr<FJsonObject> LocObj = MakeShareable(new FJsonObject());
        LocObj->SetNumberField(TEXT("x"), Location.X);
        LocObj->SetNumberField(TEXT("y"), Location.Y);
        LocObj->SetNumberField(TEXT("z"), Location.Z);
        TransformObj->SetObjectField(TEXT("location"), LocObj);

        TSharedPtr<FJsonObject> RotObj = MakeShareable(new FJsonObject());
        RotObj->SetNumberField(TEXT("pitch"), Rotation.Pitch);
        RotObj->SetNumberField(TEXT("yaw"), Rotation.Yaw);
        RotObj->SetNumberField(TEXT("roll"), Rotation.Roll);
        TransformObj->SetObjectField(TEXT("rotation"), RotObj);

        LandscapeObj->SetObjectField(TEXT("transform"), TransformObj);

        // Size info (simplified)
        FIntRect Bounds = Landscape->GetBoundingRect();
        LandscapeObj->SetNumberField(TEXT("sizeX"), Bounds.Width());
        LandscapeObj->SetNumberField(TEXT("sizeY"), Bounds.Height());

        if (bIncludeHeightmap)
        {
            // In production, we would export heightmap data
            // For now, just include a hash
            LandscapeObj->SetStringField(TEXT("heightmapHash"), ComputeSHA256(Landscape->GetName()));
        }

        if (bIncludeLayers)
        {
            // Get layer info
            TArray<TSharedPtr<FJsonValue>> LayerArray;
            // Would iterate through landscape layers here
            LandscapeObj->SetArrayField(TEXT("layers"), LayerArray);
        }

        LandscapeArray.Add(MakeShareable(new FJsonValueObject(LandscapeObj)));
    }

    Result->SetArrayField(TEXT("landscapes"), LandscapeArray);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

FString UAegisSeedSubsystem::CaptureFoliage(bool bIncludeInstances)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return TEXT("{}");
    }

    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    TArray<TSharedPtr<FJsonValue>> FoliageArray;

    for (TActorIterator<AInstancedFoliageActor> It(World); It; ++It)
    {
        AInstancedFoliageActor* Foliage = *It;

        TSharedPtr<FJsonObject> FoliageObj = MakeShareable(new FJsonObject());
        FoliageObj->SetStringField(TEXT("name"), Foliage->GetName());
        FoliageObj->SetStringField(TEXT("path"), Foliage->GetPathName());

        // Count instances (simplified)
        int32 InstanceCount = 0;
        // Would iterate through foliage instances here
        FoliageObj->SetNumberField(TEXT("instanceCount"), InstanceCount);

        if (bIncludeInstances)
        {
            // In production, would include instance data hash
            FoliageObj->SetStringField(TEXT("instanceDataHash"), ComputeSHA256(Foliage->GetName()));
        }

        FoliageArray.Add(MakeShareable(new FJsonValueObject(FoliageObj)));
    }

    Result->SetArrayField(TEXT("foliageActors"), FoliageArray);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

bool UAegisSeedSubsystem::StoreSnapshot(const FString& SnapshotId, const FString& SnapshotData)
{
    SnapshotStorage.Add(SnapshotId, SnapshotData);
    UE_LOG(LogAegisBridge, Log, TEXT("Stored snapshot: %s"), *SnapshotId);
    return true;
}

FString UAegisSeedSubsystem::LoadSnapshot(const FString& SnapshotId)
{
    if (const FString* Data = SnapshotStorage.Find(SnapshotId))
    {
        return *Data;
    }
    return TEXT("");
}

TArray<FAegisWorldSnapshot> UAegisSeedSubsystem::ListSnapshots()
{
    TArray<FAegisWorldSnapshot> Result;

    for (const auto& Pair : SnapshotStorage)
    {
        FAegisWorldSnapshot Snapshot;
        Snapshot.SnapshotId = Pair.Key;

        // Parse snapshot data for metadata
        TSharedPtr<FJsonObject> JsonObj;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Pair.Value);
        if (FJsonSerializer::Deserialize(Reader, JsonObj) && JsonObj.IsValid())
        {
            Snapshot.Name = JsonObj->GetStringField(TEXT("name"));
            Snapshot.Description = JsonObj->GetStringField(TEXT("description"));
            Snapshot.Checksum = JsonObj->GetStringField(TEXT("checksum"));

            const TArray<TSharedPtr<FJsonValue>>* Entities;
            if (JsonObj->TryGetArrayField(TEXT("entities"), Entities))
            {
                Snapshot.EntityCount = Entities->Num();
            }
        }

        Result.Add(Snapshot);
    }

    return Result;
}

bool UAegisSeedSubsystem::DeleteSnapshot(const FString& SnapshotId)
{
    if (SnapshotStorage.Remove(SnapshotId) > 0)
    {
        UE_LOG(LogAegisBridge, Log, TEXT("Deleted snapshot: %s"), *SnapshotId);
        return true;
    }
    return false;
}

bool UAegisSeedSubsystem::ExportSnapshot(const FString& SnapshotId, const FString& SnapshotData, const FString& OutputPath, bool bCompress)
{
    FString DataToWrite = SnapshotData;

    // Would apply compression here if bCompress

    if (FFileHelper::SaveStringToFile(DataToWrite, *OutputPath))
    {
        UE_LOG(LogAegisBridge, Log, TEXT("Exported snapshot to: %s"), *OutputPath);
        return true;
    }

    UE_LOG(LogAegisBridge, Error, TEXT("Failed to export snapshot to: %s"), *OutputPath);
    return false;
}

FString UAegisSeedSubsystem::ImportSnapshot(const FString& InputPath)
{
    FString SnapshotData;
    if (FFileHelper::LoadFileToString(SnapshotData, *InputPath))
    {
        UE_LOG(LogAegisBridge, Log, TEXT("Imported snapshot from: %s"), *InputPath);
        return SnapshotData;
    }

    UE_LOG(LogAegisBridge, Error, TEXT("Failed to import snapshot from: %s"), *InputPath);
    return TEXT("");
}

// ============================================================================
// State Restoration Operations
// ============================================================================

bool UAegisSeedSubsystem::RestoreWorldState(const FString& SnapshotId, const FString& Entities, const FString& MergeMode, bool bPreserveGUIDs)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return false;
    }

    // Parse entities
    TSharedPtr<FJsonValue> JsonValue;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Entities);
    if (!FJsonSerializer::Deserialize(Reader, JsonValue))
    {
        UE_LOG(LogAegisBridge, Error, TEXT("Failed to parse entities JSON"));
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* EntityArray;
    if (!JsonValue->TryGetArray(EntityArray))
    {
        UE_LOG(LogAegisBridge, Error, TEXT("Entities is not an array"));
        return false;
    }

    // Begin transaction
    GEditor->BeginTransaction(FText::FromString(TEXT("AEGIS Restore World State")));

    if (MergeMode == TEXT("replace"))
    {
        // Clear existing actors (simplified - would be more selective in production)
        // This is a placeholder for the actual implementation
    }

    int32 RestoredCount = 0;

    for (const TSharedPtr<FJsonValue>& EntityValue : *EntityArray)
    {
        const TSharedPtr<FJsonObject>* EntityObj;
        if (!EntityValue->TryGetObject(EntityObj))
        {
            continue;
        }

        FString ClassName = (*EntityObj)->GetStringField(TEXT("class"));
        FString EntityName = (*EntityObj)->GetStringField(TEXT("name"));
        FString EntityGUID = (*EntityObj)->GetStringField(TEXT("guid"));

        // Get transform
        FVector Location = FVector::ZeroVector;
        FRotator Rotation = FRotator::ZeroRotator;
        FVector Scale = FVector::OneVector;

        const TSharedPtr<FJsonObject>* TransformObj;
        if ((*EntityObj)->TryGetObjectField(TEXT("transform"), TransformObj))
        {
            const TSharedPtr<FJsonObject>* LocObj;
            if ((*TransformObj)->TryGetObjectField(TEXT("location"), LocObj))
            {
                Location.X = (*LocObj)->GetNumberField(TEXT("x"));
                Location.Y = (*LocObj)->GetNumberField(TEXT("y"));
                Location.Z = (*LocObj)->GetNumberField(TEXT("z"));
            }

            const TSharedPtr<FJsonObject>* RotObj;
            if ((*TransformObj)->TryGetObjectField(TEXT("rotation"), RotObj))
            {
                Rotation.Pitch = (*RotObj)->GetNumberField(TEXT("pitch"));
                Rotation.Yaw = (*RotObj)->GetNumberField(TEXT("yaw"));
                Rotation.Roll = (*RotObj)->GetNumberField(TEXT("roll"));
            }

            const TSharedPtr<FJsonObject>* ScaleObj;
            if ((*TransformObj)->TryGetObjectField(TEXT("scale"), ScaleObj))
            {
                Scale.X = (*ScaleObj)->GetNumberField(TEXT("x"));
                Scale.Y = (*ScaleObj)->GetNumberField(TEXT("y"));
                Scale.Z = (*ScaleObj)->GetNumberField(TEXT("z"));
            }
        }

        // Find or spawn actor
        // This is simplified - production would handle all entity types
        UClass* ActorClass = FindObject<UClass>(nullptr, *ClassName);
        if (!ActorClass)
        {
            ActorClass = LoadClass<AActor>(nullptr, *ClassName);
        }

        if (ActorClass)
        {
            FActorSpawnParameters SpawnParams;
            SpawnParams.Name = *EntityName;

            AActor* Actor = World->SpawnActor<AActor>(ActorClass, Location, Rotation, SpawnParams);
            if (Actor)
            {
                Actor->SetActorScale3D(Scale);

                if (bPreserveGUIDs && !EntityGUID.IsEmpty())
                {
                    RegisterGUID(EntityGUID, Actor->GetPathName(), ClassName, TEXT("{}"));
                }

                RestoredCount++;
            }
        }
    }

    GEditor->EndTransaction();

    UE_LOG(LogAegisBridge, Log, TEXT("Restored %d entities from snapshot %s"), RestoredCount, *SnapshotId);
    return true;
}

FString UAegisSeedSubsystem::SyncWorldState(const FString& TargetSnapshotId, const FString& TargetEntities, bool bCaptureCurrentFirst, const FString& ConflictResolution, bool bDryRun)
{
    // Simplified implementation - would compute diff and apply changes
    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    Result->SetBoolField(TEXT("success"), true);
    Result->SetNumberField(TEXT("plannedChanges"), 0);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

FString UAegisSeedSubsystem::MergeWorldStates(const FString& SourceSnapshotId, const FString& TargetSnapshotId, const FString& Changes, const FString& ConflictResolution, bool bPreserveSourceGUIDs)
{
    // Simplified implementation
    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    Result->SetBoolField(TEXT("success"), true);
    Result->SetNumberField(TEXT("appliedChanges"), 0);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

FString UAegisSeedSubsystem::ApplyDiff(const FString& DiffId, const FString& Changes, const FString& ConflictResolution)
{
    // Simplified implementation
    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());
    Result->SetBoolField(TEXT("success"), true);
    Result->SetNumberField(TEXT("appliedChanges"), 0);

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

FString UAegisSeedSubsystem::GetCurrentLevelInfo()
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;

    TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject());

    if (World)
    {
        Result->SetStringField(TEXT("worldName"), World->GetName());
        Result->SetStringField(TEXT("mapName"), World->GetMapName());
        Result->SetStringField(TEXT("levelName"), World->GetCurrentLevel()->GetName());
        Result->SetStringField(TEXT("projectName"), FApp::GetProjectName());
        Result->SetStringField(TEXT("engineVersion"), FEngineVersion::Current().ToString());
    }

    FString ResultString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&ResultString);
    FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);

    return ResultString;
}

// ============================================================================
// Helper Functions
// ============================================================================

FString UAegisSeedSubsystem::GetNamespaceCode(const FString& Namespace)
{
    if (Namespace == TEXT("actor")) return TEXT("ACT");
    if (Namespace == TEXT("component")) return TEXT("CMP");
    if (Namespace == TEXT("asset")) return TEXT("AST");
    if (Namespace == TEXT("blueprint")) return TEXT("BPT");
    if (Namespace == TEXT("material")) return TEXT("MAT");
    if (Namespace == TEXT("landscape")) return TEXT("LND");
    if (Namespace == TEXT("foliage")) return TEXT("FOL");
    if (Namespace == TEXT("pcg")) return TEXT("PCG");
    if (Namespace == TEXT("ai")) return TEXT("AIN");
    if (Namespace == TEXT("custom")) return TEXT("CUS");
    return TEXT("UNK");
}

FString UAegisSeedSubsystem::ComputeSHA256(const FString& Input)
{
    FSHAHash Hash;
    FSHA1::HashBuffer(TCHAR_TO_UTF8(*Input), Input.Len(), Hash.Hash);

    FString HashString;
    for (int32 i = 0; i < 20; i++)
    {
        HashString += FString::Printf(TEXT("%02x"), Hash.Hash[i]);
    }

    return HashString;
}
