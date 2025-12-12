// Copyright AEGIS Team. All Rights Reserved.

#include "AegisSubsystem.h"
#include "Editor.h"
#include "Engine/World.h"
#include "Engine/Level.h"
#include "GameFramework/Actor.h"
#include "Components/ActorComponent.h"
#include "Engine/Blueprint.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "EditorAssetLibrary.h"
#include "FileHelpers.h"
#include "LevelEditor.h"
#include "Json.h"
#include "JsonUtilities.h"

DEFINE_LOG_CATEGORY(LogAegisSubsystem);

UAegisSubsystem* UAegisSubsystem::Get()
{
    if (GEditor)
    {
        return GEditor->GetEditorSubsystem<UAegisSubsystem>();
    }
    return nullptr;
}

void UAegisSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    UE_LOG(LogAegisSubsystem, Log, TEXT("AEGIS Subsystem initialized"));
}

void UAegisSubsystem::Deinitialize()
{
    UE_LOG(LogAegisSubsystem, Log, TEXT("AEGIS Subsystem deinitialized"));
    Super::Deinitialize();
}

// ============================================================================
// Actor Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::SpawnActor(const FAegisSpawnParams& Params)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return MakeError(TEXT("No valid world context"), TEXT("NO_WORLD"));
    }

    // Find class
    UClass* ActorClass = FindObject<UClass>(nullptr, *Params.ClassName);
    if (!ActorClass)
    {
        ActorClass = LoadClass<AActor>(nullptr, *Params.ClassName);
    }
    if (!ActorClass)
    {
        return MakeError(FString::Printf(TEXT("Class not found: %s"), *Params.ClassName), TEXT("CLASS_NOT_FOUND"));
    }

    // Spawn actor
    FActorSpawnParameters SpawnParams;
    SpawnParams.Name = *Params.ActorName;
    SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

    AActor* NewActor = World->SpawnActor<AActor>(ActorClass, Params.Location, Params.Rotation, SpawnParams);
    if (!NewActor)
    {
        return MakeError(TEXT("Failed to spawn actor"), TEXT("SPAWN_FAILED"));
    }

    // Set scale
    NewActor->SetActorScale3D(Params.Scale);

    // Apply properties
    for (const auto& Prop : Params.Properties)
    {
        FProperty* Property = NewActor->GetClass()->FindPropertyByName(*Prop.Key);
        if (Property)
        {
            Property->ImportText_Direct(*Prop.Value, Property->ContainerPtrToValuePtr<void>(NewActor), NewActor, PPF_None);
        }
    }

    // Mark level dirty
    World->MarkPackageDirty();

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("actorName"), NewActor->GetName());
    ResultData->SetStringField(TEXT("actorPath"), NewActor->GetPathName());
    ResultData->SetStringField(TEXT("actorClass"), NewActor->GetClass()->GetName());

    return MakeSuccess(FString::Printf(TEXT("Spawned actor: %s"), *NewActor->GetName()), ResultData);
}

FAegisCommandResult UAegisSubsystem::DeleteActor(const FString& ActorPath)
{
    AActor* Actor = FindActorByPath(ActorPath);
    if (!Actor)
    {
        return MakeError(FString::Printf(TEXT("Actor not found: %s"), *ActorPath), TEXT("ACTOR_NOT_FOUND"));
    }

    FString ActorName = Actor->GetName();

    // Begin transaction for undo
    GEditor->BeginTransaction(FText::FromString(TEXT("AEGIS Delete Actor")));

    Actor->Modify();
    Actor->Destroy();

    GEditor->EndTransaction();

    return MakeSuccess(FString::Printf(TEXT("Deleted actor: %s"), *ActorName));
}

FAegisCommandResult UAegisSubsystem::ModifyActor(const FString& ActorPath, const TMap<FString, FString>& Properties)
{
    AActor* Actor = FindActorByPath(ActorPath);
    if (!Actor)
    {
        return MakeError(FString::Printf(TEXT("Actor not found: %s"), *ActorPath), TEXT("ACTOR_NOT_FOUND"));
    }

    GEditor->BeginTransaction(FText::FromString(TEXT("AEGIS Modify Actor")));
    Actor->Modify();

    int32 ModifiedCount = 0;
    for (const auto& Prop : Properties)
    {
        // Handle transform properties specially
        if (Prop.Key == TEXT("Location"))
        {
            FVector Location;
            if (Location.InitFromString(Prop.Value))
            {
                Actor->SetActorLocation(Location);
                ModifiedCount++;
            }
        }
        else if (Prop.Key == TEXT("Rotation"))
        {
            FRotator Rotation;
            if (Rotation.InitFromString(Prop.Value))
            {
                Actor->SetActorRotation(Rotation);
                ModifiedCount++;
            }
        }
        else if (Prop.Key == TEXT("Scale"))
        {
            FVector Scale;
            if (Scale.InitFromString(Prop.Value))
            {
                Actor->SetActorScale3D(Scale);
                ModifiedCount++;
            }
        }
        else
        {
            FProperty* Property = Actor->GetClass()->FindPropertyByName(*Prop.Key);
            if (Property)
            {
                Property->ImportText_Direct(*Prop.Value, Property->ContainerPtrToValuePtr<void>(Actor), Actor, PPF_None);
                ModifiedCount++;
            }
        }
    }

    GEditor->EndTransaction();

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetNumberField(TEXT("modifiedProperties"), ModifiedCount);

    return MakeSuccess(FString::Printf(TEXT("Modified %d properties on %s"), ModifiedCount, *Actor->GetName()), ResultData);
}

FAegisCommandResult UAegisSubsystem::QueryActors(const FString& ClassFilter, const FString& NameFilter, const TArray<FString>& Tags)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return MakeError(TEXT("No valid world context"), TEXT("NO_WORLD"));
    }

    TArray<TSharedPtr<FJsonValue>> ActorArray;

    for (TActorIterator<AActor> It(World); It; ++It)
    {
        AActor* Actor = *It;

        // Apply class filter
        if (!ClassFilter.IsEmpty() && !Actor->GetClass()->GetName().Contains(ClassFilter))
        {
            continue;
        }

        // Apply name filter
        if (!NameFilter.IsEmpty() && !Actor->GetName().Contains(NameFilter))
        {
            continue;
        }

        // Apply tag filter
        if (Tags.Num() > 0)
        {
            bool bHasAllTags = true;
            for (const FString& Tag : Tags)
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

        TSharedPtr<FJsonObject> ActorObj = ActorToJson(Actor, false, false);
        ActorArray.Add(MakeShareable(new FJsonValueObject(ActorObj)));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetArrayField(TEXT("actors"), ActorArray);
    ResultData->SetNumberField(TEXT("count"), ActorArray.Num());

    return MakeSuccess(FString::Printf(TEXT("Found %d actors"), ActorArray.Num()), ResultData);
}

FAegisCommandResult UAegisSubsystem::GetActorInfo(const FString& ActorPath, bool bIncludeComponents, bool bIncludeProperties)
{
    AActor* Actor = FindActorByPath(ActorPath);
    if (!Actor)
    {
        return MakeError(FString::Printf(TEXT("Actor not found: %s"), *ActorPath), TEXT("ACTOR_NOT_FOUND"));
    }

    TSharedPtr<FJsonObject> ResultData = ActorToJson(Actor, bIncludeComponents, bIncludeProperties);
    return MakeSuccess(TEXT("Actor info retrieved"), ResultData);
}

FAegisCommandResult UAegisSubsystem::DuplicateActor(const FString& ActorPath, const FVector& Offset)
{
    AActor* SourceActor = FindActorByPath(ActorPath);
    if (!SourceActor)
    {
        return MakeError(FString::Printf(TEXT("Actor not found: %s"), *ActorPath), TEXT("ACTOR_NOT_FOUND"));
    }

    UWorld* World = SourceActor->GetWorld();
    if (!World)
    {
        return MakeError(TEXT("No valid world context"), TEXT("NO_WORLD"));
    }

    GEditor->BeginTransaction(FText::FromString(TEXT("AEGIS Duplicate Actor")));

    FActorSpawnParameters SpawnParams;
    SpawnParams.Template = SourceActor;

    AActor* NewActor = World->SpawnActor<AActor>(SourceActor->GetClass(), SourceActor->GetActorLocation() + Offset, SourceActor->GetActorRotation(), SpawnParams);

    GEditor->EndTransaction();

    if (!NewActor)
    {
        return MakeError(TEXT("Failed to duplicate actor"), TEXT("DUPLICATE_FAILED"));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("newActorName"), NewActor->GetName());
    ResultData->SetStringField(TEXT("newActorPath"), NewActor->GetPathName());

    return MakeSuccess(FString::Printf(TEXT("Duplicated actor: %s"), *NewActor->GetName()), ResultData);
}

FAegisCommandResult UAegisSubsystem::SelectActors(const TArray<FString>& ActorPaths, bool bAddToSelection)
{
    if (!GEditor)
    {
        return MakeError(TEXT("Editor not available"), TEXT("NO_EDITOR"));
    }

    if (!bAddToSelection)
    {
        GEditor->SelectNone(true, true, false);
    }

    int32 SelectedCount = 0;
    for (const FString& ActorPath : ActorPaths)
    {
        AActor* Actor = FindActorByPath(ActorPath);
        if (Actor)
        {
            GEditor->SelectActor(Actor, true, true, true);
            SelectedCount++;
        }
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetNumberField(TEXT("selectedCount"), SelectedCount);

    return MakeSuccess(FString::Printf(TEXT("Selected %d actors"), SelectedCount), ResultData);
}

// ============================================================================
// Blueprint Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::CreateBlueprint(const FString& BlueprintName, const FString& ParentClass, const FString& Path)
{
    UClass* ParentUClass = FindObject<UClass>(nullptr, *ParentClass);
    if (!ParentUClass)
    {
        ParentUClass = LoadClass<UObject>(nullptr, *ParentClass);
    }
    if (!ParentUClass)
    {
        ParentUClass = AActor::StaticClass();
    }

    FString PackagePath = Path.IsEmpty() ? TEXT("/Game/Blueprints") : Path;
    FString FullPath = PackagePath / BlueprintName;

    UPackage* Package = CreatePackage(*FullPath);
    if (!Package)
    {
        return MakeError(TEXT("Failed to create package"), TEXT("PACKAGE_FAILED"));
    }

    UBlueprint* NewBlueprint = FKismetEditorUtilities::CreateBlueprint(
        ParentUClass,
        Package,
        *BlueprintName,
        BPTYPE_Normal,
        UBlueprint::StaticClass(),
        UBlueprintGeneratedClass::StaticClass()
    );

    if (!NewBlueprint)
    {
        return MakeError(TEXT("Failed to create blueprint"), TEXT("CREATE_FAILED"));
    }

    // Save the package
    FString PackageFileName = FPackageName::LongPackageNameToFilename(FullPath, FPackageName::GetAssetPackageExtension());
    UPackage::SavePackage(Package, NewBlueprint, RF_Public | RF_Standalone, *PackageFileName);

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("blueprintPath"), NewBlueprint->GetPathName());
    ResultData->SetStringField(TEXT("blueprintName"), NewBlueprint->GetName());

    return MakeSuccess(FString::Printf(TEXT("Created blueprint: %s"), *BlueprintName), ResultData);
}

FAegisCommandResult UAegisSubsystem::CompileBlueprint(const FString& BlueprintPath)
{
    UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *BlueprintPath);
    if (!Blueprint)
    {
        return MakeError(FString::Printf(TEXT("Blueprint not found: %s"), *BlueprintPath), TEXT("NOT_FOUND"));
    }

    FCompilerResultsLog Results;
    FKismetEditorUtilities::CompileBlueprint(Blueprint, EBlueprintCompileOptions::None, &Results);

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetBoolField(TEXT("hasErrors"), Results.NumErrors > 0);
    ResultData->SetNumberField(TEXT("numErrors"), Results.NumErrors);
    ResultData->SetNumberField(TEXT("numWarnings"), Results.NumWarnings);

    if (Results.NumErrors > 0)
    {
        return MakeError(FString::Printf(TEXT("Blueprint compilation failed with %d errors"), Results.NumErrors), TEXT("COMPILE_FAILED"));
    }

    return MakeSuccess(TEXT("Blueprint compiled successfully"), ResultData);
}

FAegisCommandResult UAegisSubsystem::AddBlueprintComponent(const FString& BlueprintPath, const FString& ComponentClass, const FString& ComponentName)
{
    UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *BlueprintPath);
    if (!Blueprint)
    {
        return MakeError(FString::Printf(TEXT("Blueprint not found: %s"), *BlueprintPath), TEXT("NOT_FOUND"));
    }

    UClass* CompClass = FindObject<UClass>(nullptr, *ComponentClass);
    if (!CompClass)
    {
        CompClass = LoadClass<UActorComponent>(nullptr, *ComponentClass);
    }
    if (!CompClass)
    {
        return MakeError(FString::Printf(TEXT("Component class not found: %s"), *ComponentClass), TEXT("CLASS_NOT_FOUND"));
    }

    USCS_Node* NewNode = Blueprint->SimpleConstructionScript->CreateNode(CompClass, *ComponentName);
    if (!NewNode)
    {
        return MakeError(TEXT("Failed to create component node"), TEXT("CREATE_FAILED"));
    }

    Blueprint->SimpleConstructionScript->AddNode(NewNode);
    FBlueprintEditorUtils::MarkBlueprintAsModified(Blueprint);

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("componentName"), ComponentName);

    return MakeSuccess(FString::Printf(TEXT("Added component: %s"), *ComponentName), ResultData);
}

FAegisCommandResult UAegisSubsystem::AddBlueprintVariable(const FString& BlueprintPath, const FString& VariableName, const FString& VariableType)
{
    UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *BlueprintPath);
    if (!Blueprint)
    {
        return MakeError(FString::Printf(TEXT("Blueprint not found: %s"), *BlueprintPath), TEXT("NOT_FOUND"));
    }

    FEdGraphPinType PinType;
    // Parse variable type - simplified, production would need full type parsing
    if (VariableType == TEXT("bool"))
    {
        PinType.PinCategory = UEdGraphSchema_K2::PC_Boolean;
    }
    else if (VariableType == TEXT("int"))
    {
        PinType.PinCategory = UEdGraphSchema_K2::PC_Int;
    }
    else if (VariableType == TEXT("float"))
    {
        PinType.PinCategory = UEdGraphSchema_K2::PC_Real;
        PinType.PinSubCategory = UEdGraphSchema_K2::PC_Float;
    }
    else if (VariableType == TEXT("string"))
    {
        PinType.PinCategory = UEdGraphSchema_K2::PC_String;
    }
    else
    {
        PinType.PinCategory = UEdGraphSchema_K2::PC_Object;
    }

    FBlueprintEditorUtils::AddMemberVariable(Blueprint, *VariableName, PinType);
    FBlueprintEditorUtils::MarkBlueprintAsModified(Blueprint);

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("variableName"), VariableName);
    ResultData->SetStringField(TEXT("variableType"), VariableType);

    return MakeSuccess(FString::Printf(TEXT("Added variable: %s"), *VariableName), ResultData);
}

// ============================================================================
// Asset Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::SearchAssets(const FString& SearchQuery, const FString& AssetType, const FString& Path)
{
    FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
    IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();

    FARFilter Filter;

    if (!Path.IsEmpty())
    {
        Filter.PackagePaths.Add(*Path);
        Filter.bRecursivePaths = true;
    }

    if (!AssetType.IsEmpty())
    {
        Filter.ClassPaths.Add(FTopLevelAssetPath(TEXT("/Script/CoreUObject"), *AssetType));
    }

    TArray<FAssetData> AssetList;
    AssetRegistry.GetAssets(Filter, AssetList);

    TArray<TSharedPtr<FJsonValue>> AssetArray;
    for (const FAssetData& Asset : AssetList)
    {
        if (!SearchQuery.IsEmpty() && !Asset.AssetName.ToString().Contains(SearchQuery))
        {
            continue;
        }

        TSharedPtr<FJsonObject> AssetObj = MakeShareable(new FJsonObject());
        AssetObj->SetStringField(TEXT("name"), Asset.AssetName.ToString());
        AssetObj->SetStringField(TEXT("path"), Asset.GetObjectPathString());
        AssetObj->SetStringField(TEXT("class"), Asset.AssetClassPath.GetAssetName().ToString());
        AssetObj->SetStringField(TEXT("package"), Asset.PackageName.ToString());

        AssetArray.Add(MakeShareable(new FJsonValueObject(AssetObj)));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetArrayField(TEXT("assets"), AssetArray);
    ResultData->SetNumberField(TEXT("count"), AssetArray.Num());

    return MakeSuccess(FString::Printf(TEXT("Found %d assets"), AssetArray.Num()), ResultData);
}

FAegisCommandResult UAegisSubsystem::LoadAsset(const FString& AssetPath)
{
    UObject* Asset = UEditorAssetLibrary::LoadAsset(AssetPath);
    if (!Asset)
    {
        return MakeError(FString::Printf(TEXT("Failed to load asset: %s"), *AssetPath), TEXT("LOAD_FAILED"));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("assetPath"), Asset->GetPathName());
    ResultData->SetStringField(TEXT("assetClass"), Asset->GetClass()->GetName());

    return MakeSuccess(TEXT("Asset loaded"), ResultData);
}

FAegisCommandResult UAegisSubsystem::ImportAsset(const FString& SourcePath, const FString& DestinationPath)
{
    // This is a simplified implementation - production would use asset import factories
    return MakeError(TEXT("Import not implemented - use Content Browser"), TEXT("NOT_IMPLEMENTED"));
}

FAegisCommandResult UAegisSubsystem::ExportAsset(const FString& AssetPath, const FString& ExportPath)
{
    // This is a simplified implementation - production would use asset export
    return MakeError(TEXT("Export not implemented - use Content Browser"), TEXT("NOT_IMPLEMENTED"));
}

// ============================================================================
// Level Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::LoadLevel(const FString& LevelPath)
{
    if (!FEditorFileUtils::LoadMap(LevelPath))
    {
        return MakeError(FString::Printf(TEXT("Failed to load level: %s"), *LevelPath), TEXT("LOAD_FAILED"));
    }

    return MakeSuccess(FString::Printf(TEXT("Loaded level: %s"), *LevelPath));
}

FAegisCommandResult UAegisSubsystem::SaveLevel()
{
    if (!FEditorFileUtils::SaveCurrentLevel())
    {
        return MakeError(TEXT("Failed to save level"), TEXT("SAVE_FAILED"));
    }

    return MakeSuccess(TEXT("Level saved"));
}

FAegisCommandResult UAegisSubsystem::CreateLevel(const FString& LevelName, const FString& TemplateName)
{
    // Create new level - simplified implementation
    FString PackagePath = FString::Printf(TEXT("/Game/Maps/%s"), *LevelName);

    UWorld* NewWorld = UWorld::CreateWorld(EWorldType::Editor, false);
    if (!NewWorld)
    {
        return MakeError(TEXT("Failed to create world"), TEXT("CREATE_FAILED"));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("levelName"), LevelName);

    return MakeSuccess(FString::Printf(TEXT("Created level: %s"), *LevelName), ResultData);
}

FAegisCommandResult UAegisSubsystem::GetLevelInfo()
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World)
    {
        return MakeError(TEXT("No valid world context"), TEXT("NO_WORLD"));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetStringField(TEXT("worldName"), World->GetName());
    ResultData->SetStringField(TEXT("mapName"), World->GetMapName());
    ResultData->SetNumberField(TEXT("actorCount"), World->GetActorCount());

    // Get streaming levels
    TArray<TSharedPtr<FJsonValue>> LevelArray;
    for (ULevelStreaming* StreamingLevel : World->GetStreamingLevels())
    {
        TSharedPtr<FJsonObject> LevelObj = MakeShareable(new FJsonObject());
        LevelObj->SetStringField(TEXT("name"), StreamingLevel->GetWorldAssetPackageName());
        LevelObj->SetBoolField(TEXT("loaded"), StreamingLevel->IsLevelLoaded());
        LevelArray.Add(MakeShareable(new FJsonValueObject(LevelObj)));
    }
    ResultData->SetArrayField(TEXT("streamingLevels"), LevelArray);

    return MakeSuccess(TEXT("Level info retrieved"), ResultData);
}

// ============================================================================
// Editor Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::ExecuteEditorCommand(const FString& Command)
{
    if (GEditor)
    {
        GEditor->Exec(GEditor->GetEditorWorldContext().World(), *Command);
        return MakeSuccess(FString::Printf(TEXT("Executed command: %s"), *Command));
    }
    return MakeError(TEXT("Editor not available"), TEXT("NO_EDITOR"));
}

FAegisCommandResult UAegisSubsystem::Undo()
{
    if (GEditor && GEditor->Trans)
    {
        if (GEditor->Trans->Undo())
        {
            return MakeSuccess(TEXT("Undo successful"));
        }
    }
    return MakeError(TEXT("Nothing to undo"), TEXT("NOTHING_TO_UNDO"));
}

FAegisCommandResult UAegisSubsystem::Redo()
{
    if (GEditor && GEditor->Trans)
    {
        if (GEditor->Trans->Redo())
        {
            return MakeSuccess(TEXT("Redo successful"));
        }
    }
    return MakeError(TEXT("Nothing to redo"), TEXT("NOTHING_TO_REDO"));
}

FAegisCommandResult UAegisSubsystem::GetSelection()
{
    if (!GEditor)
    {
        return MakeError(TEXT("Editor not available"), TEXT("NO_EDITOR"));
    }

    TArray<AActor*> SelectedActors;
    GEditor->GetSelectedActors()->GetSelectedObjects<AActor>(SelectedActors);

    TArray<TSharedPtr<FJsonValue>> ActorArray;
    for (AActor* Actor : SelectedActors)
    {
        ActorArray.Add(MakeShareable(new FJsonValueObject(ActorToJson(Actor, false, false))));
    }

    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());
    ResultData->SetArrayField(TEXT("selectedActors"), ActorArray);
    ResultData->SetNumberField(TEXT("count"), ActorArray.Num());

    return MakeSuccess(FString::Printf(TEXT("Selection: %d actors"), ActorArray.Num()), ResultData);
}

FAegisCommandResult UAegisSubsystem::FocusActor(const FString& ActorPath)
{
    AActor* Actor = FindActorByPath(ActorPath);
    if (!Actor)
    {
        return MakeError(FString::Printf(TEXT("Actor not found: %s"), *ActorPath), TEXT("ACTOR_NOT_FOUND"));
    }

    GEditor->MoveViewportCamerasToActor(*Actor, false);
    return MakeSuccess(FString::Printf(TEXT("Focused on actor: %s"), *Actor->GetName()));
}

// ============================================================================
// Context Operations
// ============================================================================

FAegisCommandResult UAegisSubsystem::GetEditorContext()
{
    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());

    // World info
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (World)
    {
        TSharedPtr<FJsonObject> WorldObj = MakeShareable(new FJsonObject());
        WorldObj->SetStringField(TEXT("name"), World->GetName());
        WorldObj->SetStringField(TEXT("mapName"), World->GetMapName());
        WorldObj->SetNumberField(TEXT("actorCount"), World->GetActorCount());
        ResultData->SetObjectField(TEXT("world"), WorldObj);
    }

    // Selection
    if (GEditor)
    {
        TArray<AActor*> SelectedActors;
        GEditor->GetSelectedActors()->GetSelectedObjects<AActor>(SelectedActors);

        TArray<TSharedPtr<FJsonValue>> SelectionArray;
        for (AActor* Actor : SelectedActors)
        {
            TSharedPtr<FJsonObject> ActorObj = MakeShareable(new FJsonObject());
            ActorObj->SetStringField(TEXT("name"), Actor->GetName());
            ActorObj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
            SelectionArray.Add(MakeShareable(new FJsonValueObject(ActorObj)));
        }
        ResultData->SetArrayField(TEXT("selection"), SelectionArray);
    }

    // Editor mode
    ResultData->SetBoolField(TEXT("isPlaying"), GEditor ? GEditor->IsPlayingSessionInEditor() : false);
    ResultData->SetBoolField(TEXT("isSimulating"), GEditor ? GEditor->IsSimulatingInEditor() : false);

    return MakeSuccess(TEXT("Editor context retrieved"), ResultData);
}

FAegisCommandResult UAegisSubsystem::GetProjectInfo()
{
    TSharedPtr<FJsonObject> ResultData = MakeShareable(new FJsonObject());

    ResultData->SetStringField(TEXT("projectName"), FApp::GetProjectName());
    ResultData->SetStringField(TEXT("engineVersion"), FEngineVersion::Current().ToString());
    ResultData->SetStringField(TEXT("projectDirectory"), FPaths::ProjectDir());
    ResultData->SetStringField(TEXT("contentDirectory"), FPaths::ProjectContentDir());

    return MakeSuccess(TEXT("Project info retrieved"), ResultData);
}

// ============================================================================
// Helper Functions
// ============================================================================

AActor* UAegisSubsystem::FindActorByPath(const FString& ActorPath)
{
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World) return nullptr;

    // Try direct path lookup first
    AActor* Actor = FindObject<AActor>(World->GetCurrentLevel(), *ActorPath);
    if (Actor) return Actor;

    // Try name-based search
    for (TActorIterator<AActor> It(World); It; ++It)
    {
        if (It->GetName() == ActorPath || It->GetPathName() == ActorPath)
        {
            return *It;
        }
    }

    return nullptr;
}

TSharedPtr<FJsonObject> UAegisSubsystem::ActorToJson(AActor* Actor, bool bIncludeComponents, bool bIncludeProperties)
{
    TSharedPtr<FJsonObject> ActorObj = MakeShareable(new FJsonObject());

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
    if (bIncludeComponents)
    {
        TArray<TSharedPtr<FJsonValue>> CompArray;
        for (UActorComponent* Component : Actor->GetComponents())
        {
            TSharedPtr<FJsonObject> CompObj = MakeShareable(new FJsonObject());
            CompObj->SetStringField(TEXT("name"), Component->GetName());
            CompObj->SetStringField(TEXT("class"), Component->GetClass()->GetName());
            CompArray.Add(MakeShareable(new FJsonValueObject(CompObj)));
        }
        ActorObj->SetArrayField(TEXT("components"), CompArray);
    }

    return ActorObj;
}

FAegisCommandResult UAegisSubsystem::MakeSuccess(const FString& Message, const TSharedPtr<FJsonObject>& Data)
{
    FAegisCommandResult Result;
    Result.bSuccess = true;
    Result.Message = Message;

    if (Data.IsValid())
    {
        FString DataString;
        TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&DataString);
        FJsonSerializer::Serialize(Data.ToSharedRef(), Writer);
        Result.Data = DataString;
    }

    return Result;
}

FAegisCommandResult UAegisSubsystem::MakeError(const FString& Message, const FString& ErrorCode)
{
    FAegisCommandResult Result;
    Result.bSuccess = false;
    Result.Message = Message;
    Result.ErrorCode = ErrorCode;
    return Result;
}
