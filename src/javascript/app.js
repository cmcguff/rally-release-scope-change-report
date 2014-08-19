Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    prefixes: {},
    preliminary_estimates: {},
    iterations: {},
    visibleIterations: {},
    releaseStartDate: '',
    releaseEndDate: '',
    iterationColumn: 8,

    // default item types to include in the results
    show_types: ['HierarchicalRequirement', 'Defect'],
    // show_types: ['HierarchicalRequirement','Defect','PortfolioItem'], 

    // field to use for item sizing
    alternate_pi_size_field: 'PlanEstimate',
    // size field for portfolio items   
    // alternate_pi_size_field: 'c_PIPlanEstimate', 

    // schedule state names
    schedule_states: ["Backlog", "Defined", "In-Progress", "Completed", "Accepted", "Released"],
    // schedule states to be removed from the grid view
    ignore_schedule_states: ["Backlog", "Defined", "In-Progress", "Released"],
    
    logger: new Rally.technicalservices.Logger(),
    items: [
        {xtype: 'container', itemId: 'header_box', defaults: { padding: 5, margin: 5}, layout: { type: 'hbox'}, items: [
            {xtype: 'container', itemId: 'release_selector_box'},
            {xtype: 'container', itemId: 'release_description_box', padding: 10, tpl: '<tpl>{msg}</tpl>'}
        ]},
        {xtype: 'container', itemId: 'options_box', padding: 10},
        {xtype: 'container', itemId: 'iteration_summary_grid', padding: 10},
        {xtype: 'container', itemId: 'daily_box', padding: 10},
        {xtype: 'tsinfolink'}
    ],
    launch: function() {
        this.logger.log("Launched with this context ", this.getContext());
        Deft.Chain.pipeline([this._setPrefixes, this._setPreliminaryEstimates, this._getIterations],this).then({
            scope: this,
            success: function(throw_away) {
                this._addReleaseBox();
            },
            failure: function(error) {
                alert(error);
            }
        });
    },
    _setPrefixes: function() {
        this.logger.log("_setPrefixes");
        var me = this;
        var deferred = Ext.create('Deft.Deferred');
        var pi_filter = Ext.create('Rally.data.wsapi.Filter',{property:'TypePath',operator:'contains',value:"PortfolioItem/"});
        var story_filter = Ext.create('Rally.data.wsapi.Filter',{property:'TypePath',operator:'contains',value:"Hierarchical"});
        var defect_filter = Ext.create('Rally.data.wsapi.Filter',{property:'TypePath',operator:'contains',value:"Defect"});

        var filters = pi_filter.or(story_filter.or(defect_filter));
        
        Ext.create('Rally.data.wsapi.Store',{
            model:'TypeDefinition',
            autoLoad: true,
            filters: filters,
            listeners: {
                scope: this,
                load: function(store,records,successful){
                    if ( ! successful ) {
                        deferred.reject("There was a problem finding type definitions for prefixes.");
                    } else {
                        var prefixes = {};
                        Ext.Array.each(records,function(record){
                            prefixes[record.get('TypePath')] = record.get('IDPrefix');
                        });
                        this.prefixes = prefixes;
                        deferred.resolve([]);
                    }
                }
            }
        });
        return deferred;
    },
    _setPreliminaryEstimates: function() {
        this.logger.log("_setPreliminaryEstimates");
        var me = this;
        //preliminary_estimates
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',{
            model:'PreliminaryEstimate',
            autoLoad: true,
            fetch: ['ObjectID','Value'],
            listeners: {
                scope: this,
                load: function(store,records,successful){
                    if ( ! successful ) {
                        deferred.reject("There was a problem finding values for PreliminaryEstimates.");
                    } else {
                        var estimates = {};
                        Ext.Array.each(records,function(record){
                            estimates[record.get('ObjectID')] = record.get('Value');
                        });
                        this.preliminary_estimates = estimates;
                        deferred.resolve([]);
                    }
                }
            }
        });
        return deferred;
    },
    _getIterations: function() {
        this.logger.log("_getIterations");
        var me = this;
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',{
            model:'Iteration',
            autoLoad: true,
            fetch: ['ObjectID', 'Name', 'StartDate', 'EndDate'],
            sorters: [
                {property: 'EndDate', direction: 'ASC'}
            ],            
            listeners: {
                scope: this,
                load: function(store,records,successful){
                    if ( ! successful ) {
                        deferred.reject("There was a problem getting the list of Iterations.");
                    } else {
                        var iterations = [];
                        Ext.Array.each(records,function(record){
                            var id = record.get('ObjectID');
                            var columnID = "Iteration_" + id;
                            var estimateID = "Estimate_" + id;
                            var hoverID = "Hover_" + id;
                            var detailID = "Detail_" + id;
                            var name = record.get('Name');
                            var startDate = record.get('StartDate');
                            var endDate = record.get('EndDate');
                            var include = false;
                            iterations.push({ID: id, Name: name, StartDate: startDate, EndDate: endDate, Include: include, ColumnID: columnID, EstimateID: estimateID, HoverID: hoverID, DetailID: detailID});    
                            console.info('ID: ', id, 
                                '  Name: ', name,  
                                '  StartDate: ', startDate,                           
                                '  EndDate: ', endDate,
                                '  Include: ', include,
                                '  ColumnID: ', columnID,
                                '  EstimateID: ', estimateID,
                                '  HoverID: ', hoverID,
                                '  DetailID: ', detailID);
                        });
                        this.iterations = iterations;
                        deferred.resolve([]);
                    }
                }
            }
        });
        return deferred;
    },    
    _addReleaseBox: function() {
        this.down('#release_selector_box').add({
            xtype:'rallyreleasecombobox',
            fieldLabel: 'Release',
            labelWidth: 35,
            listeners: {
                scope: this,
                change: function(rb) {
                    this.logger.log("Release Changed ", rb.getRecord());
                    this.setLoading();
                    this.down('#iteration_summary_grid').removeAll();
                    this.down('#daily_box').removeAll();
                    this.down('#release_description_box').update(this._getReleaseSummary(rb.getRecord()));
                    this._getDailySummaries(rb.getRecord());
                }
            }
        });
    },
    _getReleaseSummary: function(release) {
        var message_wrapper = { msg: "" };
        var today = new Date();
        
        var start_js  = release.get('ReleaseStartDate');
        var start_iso = Rally.util.DateTime.toIsoString(start_js).replace(/T.*$/,"");
        var end_js    = release.get('ReleaseDate');
        var end_iso   = Rally.util.DateTime.toIsoString(end_js).replace(/T.*$/,"");
        
        this.releaseStartDate = start_iso;

        var number_of_days_in_release = Rally.technicalservices.util.Utilities.daysBetween(start_js,end_js) + 1 ;
        var number_of_days_remaining_in_release = Rally.technicalservices.util.Utilities.daysBetween(today,end_js) + 1 ;
        
        var msg = start_iso + " - " + end_iso;
        if ( today < start_js ) {
            msg += " (" + number_of_days_in_release + " Days, Not Started)";
        } else if ( today > end_js ) {
            msg += " (" + number_of_days_in_release + " Days, Done)";
        } else {
            msg += " (" + number_of_days_in_release + " Days, " + number_of_days_remaining_in_release + " Days remaining)";
        }
                
        message_wrapper.msg = msg;
        return message_wrapper;
    },
    _getDailySummaries: function(release){
        this.logger.log("_getDailySummaries ",release);
        var today = new Date();
        var start_js  = release.get('ReleaseStartDate');
        var end_js    = release.get('ReleaseDate');
        
        if ( today < start_js ) {
            this.setLoading(false);
            this.down('#iteration_summary_grid').add({
                xtype:'container',
                html:'Release has not started yet.'
            });
        } else {
            this.release_name = release.get('Name');
            this.start_date = start_js;
            this.end_date = end_js;

            /* CM mark the iterations that fall within this release */
            var visibleIterations = []; 
            Ext.Array.each(this.iterations,function(iteration){
                if ( iteration.StartDate < start_js ) // iteration started before the release did
                    if ( iteration.EndDate < start_js ) // iteration started and ended before the release started
                        iteration.Include = false;
                    else // release started mid iteration
                        iteration.Include = true;
                else // iteration started after the release did    
                    if ( iteration.EndDate < end_js ) // this iteration completed before the release
                        iteration.Include = true;
                    else // iteration ended after the release
                        iteration.Include = false;
                
                if (iteration.Include)
                    visibleIterations.push(iteration);    
            });
            this.visibleIterations = visibleIterations;    

            /* CM add new link in the chain to effectively pivot the output from _processSnaps with _pivotSnaps */
            Deft.Chain.pipeline([this._getScopedReleases, this._getSnaps, this._processSnaps, this._pivotSnaps, this._makeGrids],this).then({
                scope: this,
                success: function(result) {
                    this.logger.log("Done  ",result);
                },
                failure: function(error) {
                    alert(error);
                }
            });
        }
    },
    _getScopedReleases:function(){
        var release_name = this.release_name;
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',{
            model:'Release',
            filters: [{property:'Name',value:release_name}],
            autoLoad:true,
            listeners: {
                scope: this,
                load: function(store,records,successful){
                    if ( !successful ) {
                        deferred.reject("There was a problem finding associated Releases for " + release_name);
                    } else {
                        var oids = [];
                        Ext.Array.each(records, function(record){
                            oids.push(record.get('ObjectID'));
                        });
                        deferred.resolve(oids);
                    }
                }
            }
        });
        return deferred;
    },
    _getSnaps:function(release_oids) {
        var me = this;
        this.logger.log("_getSnaps",release_oids,release_oids.length);
        var deferred = Ext.create('Deft.Deferred');
        this.release_oids = release_oids;

        var page_size = 2;
        var total_count = release_oids.length;
        var start_index = 0;
        
        // divide up the calls because there's a limit to how many characters
        // we can put onto a GET
        var promises = [];
        while ( start_index < total_count ) {
            var oids_subset = Ext.Array.slice(release_oids,start_index,start_index+page_size);
            promises.push(this._getSnapsForSubset(oids_subset));
            start_index = start_index + page_size;
        }
        
        Deft.Promise.all(promises).then({
            scope: this,
            success: function(records) {
                var snaps = [];
                Ext.Array.each(records,function(record_collection){
                    Ext.Array.push(snaps,record_collection);
                });
                deferred.resolve(snaps);
            },
            failure: function(error) {
                deferred.reject(error);
            }
        });
            
        return deferred;
    },
    _getSnapsForSubset:function(release_oids) {
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("_getSnapsForSubset",release_oids,release_oids.length);
        var start_date_iso = Rally.util.DateTime.toIsoString(this.start_date);
        var end_date_iso = Rally.util.DateTime.toIsoString(this.end_date);
        
        var type_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_TypeHierarchy',
            operator: 'in',
            value: this.show_types
        });
        
        /* CM let's make sure we grab items added to this release before or after the official start/end
        this happens where release timeframes have been shifted.

        var date_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_ValidFrom',
            operator: '>=',
            value:start_date_iso
        }).and(Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_ValidFrom',
            operator: '<=',
            value:end_date_iso
        })); 
        */
        
        var release_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: 'Release',
            operator: 'in',
            value:release_oids
        }).or(Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_PreviousValues.Release',
            operator: 'in',
            value:release_oids
        }));
        
        var incoming_release_change_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: 'Release',
            operator: 'in',
            value:release_oids
        }).and(Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_PreviousValues.Release',
            operator: 'exists',
            value:true
        }));
        
        var outgoing_release_change_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_PreviousValues.Release',
            operator: 'in',
            value:release_oids
        });
        
        var deleted_item_from_release_change_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: 'Release',
            operator: 'in',
            value:release_oids
        }).and(Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_PreviousValues.Recycled',
            value:false
        }));
        
        var size_change_filter = Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_PreviousValues.' + this.alternate_pi_size_field,
            operator: 'exists',
            value: true
        }).and(Ext.create('Rally.data.lookback.QueryFilter', {
            property: 'Release',
            operator: 'in',
            value:release_oids
        }));
        
        var schedule_state_change_filter = Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_PreviousValues.ScheduleState',
            operator: 'in',
            value: this.schedule_states
        }).and(Ext.create('Rally.data.lookback.QueryFilter', {
            property: 'Release',
            operator: 'in',
            value:release_oids
        }));

        var type_change_filter = incoming_release_change_filter.
            or(outgoing_release_change_filter.
            or(size_change_filter).
            or(deleted_item_from_release_change_filter).
            or(schedule_state_change_filter));
        
        //var filters = type_filter.and(date_filter).and(release_filter).and(type_change_filter);
        var filters = type_filter.and(release_filter).and(type_change_filter);
        me.logger.log("Filter ", filters.toObject());
        Ext.create('Rally.data.lookback.SnapshotStore',{
            autoLoad: true,
            filters: filters,
            fetch: ['PlanEstimate','_PreviousValues','_UnformattedID','Release','_TypeHierarchy','Name','PreliminaryEstimate',this.alternate_pi_size_field,'ScheduleState','State'],
            hydrate: ['_TypeHierarchy','ScheduleState','State'],
            listeners: {
                scope: this,
                load: function(store,snaps,successful) {
                    if ( !successful ) {
                        deferred.reject("There was a problem retrieving changes");
                    } else {
                        me.logger.log("  Back for ",release_oids, snaps.length, snaps);
                        deferred.resolve(snaps);
                    }   
                }
            }
        });
        return deferred;
    },
    _processSnaps: function(snaps){
        var me = this;
        this.logger.log("_processSnaps",snaps);
        var changes = [];
        
        Ext.Array.each(snaps,function(snap){
            // CM same format as the iteraiton dates
            var base_date = Rally.util.DateTime.fromIsoString(snap.get('_ValidFrom'));

            // Display dates
            var change_date = Rally.util.DateTime.toIsoString(Rally.util.DateTime.fromIsoString(base_date)).replace(/T.*$/,"");
            var id = me._getIdFromSnap(snap);
            var previous_size = snap.get("_PreviousValues")[me.alternate_pi_size_field];
            var size = snap.get(me.alternate_pi_size_field) || 0;
                                  
            var type_hierarchy = snap.get('_TypeHierarchy');
            var type = type_hierarchy[type_hierarchy.length - 1 ];
            
            var change_type = me._getChangeTypeFromSnap(snap);
            var scheduleState = snap.get('ScheduleState');
            var state = snap.get('State');
            var combinedState = scheduleState;



            if (state != "" && state != null )
                combinedState += " (" + state + ")";

            var size_difference = size;
            if ( change_type === "Resized" ) {
                size_difference = size - previous_size;
            }
            if ( change_type === "Removed" ) {
                size_difference = -1 * size_difference;
            }

            var releaseScope = "In Scope";
            
            if ( change_type ) {
                changes.push({
                    FormattedID: id,
                    _ref: "/" + type.toLowerCase() + "/" + snap.get('ObjectID'),
                    InitialPlanEstimate: size,
                    PlanEstimate: size,
                    ChangeDate: change_date,
                    BaseDate: base_date,
                    ChangeValue: size_difference,
                    _type: type,
                    Name: snap.get('Name'),
                    ChangeType: change_type,
                    timestamp: snap.get('_ValidFrom'),
                    id: id + '' + snap.get('_ValidFrom'),
                    ObjectID: snap.get('ObjectID'),
                    ScheduleState: scheduleState,
                    State: state,
                    CombinedState: combinedState,
                    Iteration_Pre: "",
                    Iteration_Post: "",
                    Estimate_Pre: "",
                    Estimate_Post: "",
                    Hover_Pre: "",
                    Hover_Post: "",
                    Detail_Pre: null,
                    Detail_Post: null,
                    ReleaseScope: releaseScope
                });
            }           
        });
        
        return changes;
    },

    /* 
    CM new function to pivot our view of the snapshot data rather than showing date on the y axis
    I want to see a list of unique backlog items on the y-axis and which time period it was 
    added or removed in the x-axis
    */

     _pivotSnaps: function(changes){
        var items = [];
        var iterations = this.visibleIterations;

        changes.forEach(function(entry) {

            // do we already have this item in our result set?
            var exists = -1;    
            for (i = 0;i < items.length; i++){
                if(items[i].FormattedID == entry.FormattedID){
                    // Yup, we already have it, need to add the entry into the correct timebox
                    exists = i;
                    break;
                }
            }
            if (exists == -1){
                items.push(entry);
                exists = items.length-1;
                // create blank iteration buckets
                for (i=0;i<iterations.length;i++){
                    items[exists][iterations[i].ColumnID] = "";
                    items[exists][iterations[i].EstimateID] = "";
                    items[exists][iterations[i].HoverID] = "";
                    items[exists][iterations[i].DetailID] = null;
                }                
            }

            // now we have the reference to the item we want to mess with in [exists]
            // update the relevant time period with the added/removed data
            var selectedIteration = -1;
            for (i=0;i<iterations.length;i++){
                iteration = iterations[i];
                if(entry.BaseDate >= iteration.StartDate && entry.BaseDate <= iteration.EndDate){
                    selectedIteration = i;
                    break;
                }
            }

            var colID = "";
            var estID = "";
            var hoverID = "";
            var detailID = "";

            if (selectedIteration == -1) {
                // wasn't found, possibility it is before or after visible iterations...
                var first = 0;
                var last = iterations.length-1;
                if (entry.BaseDate > iterations[last].EndDate)
                {
                    colID = "Iteration_Post";
                    estID = "Estimate_Post";
                    hoverID = "Hover_Post";
                    detailID = "Detail_Post";
                }
                else
                {
                    colID = "Iteration_Pre";
                    estID = "Estimate_Pre";
                    hoverID = "Hover_Pre";
                    detailID = "Detail_Pre";
                }
            }   
            else
            {
                colID = iterations[selectedIteration].ColumnID;
                estID = iterations[selectedIteration].EstimateID;
                hoverID = iterations[selectedIteration].HoverID;
                detailID = iterations[selectedIteration].DetailID;
            }

            var existingEntry = items[exists][colID];
            var existingHoverEntry = items[exists][hoverID];
            var existingDetailEntry = items[exists][detailID];

            // filter out undetermined entries, bit overkill, but don't want to lose any data
            if (existingEntry == null){
                existingEntry = "";
                existingHoverEntry = "";
            }

            if (existingDetailEntry == null)
            {
                existingDetailEntry = {
                    Added_Count: 0, 
                    Added_Points: 0,
                    Removed_Count: 0,
                    Removed_Points: 0,
                    Resized_Count: 0,
                    Resized_Points: 0,
                    Backlog_Count: 0,
                    Backlog_Points: 0,
                    Defined_Count: 0,
                    Defined_Points: 0,
                    InProgress_Count: 0,
                    InProgress_Points: 0,
                    Completed_Count: 0,
                    Completed_Points: 0,
                    Accepted_Count: 0,
                    Accepted_Points: 0,
                    Released_Count: 0,
                    Released_Points: 0
                };
            }

            // create an iteration entry
            if (existingEntry != "")
            {
                existingEntry += "<br/>";
                existingHoverEntry += "<br/>";
            }

            var displayDate =  entry.BaseDate; //Rally.util.DateTime.toIsoString(entry.BaseDate).replace(/T.*$/,"");
            items[exists][colID] = existingEntry + entry.ChangeType;

            // hover details for release changes   
            if (entry.ChangeType.indexOf("Added") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Added on " + displayDate;
                existingDetailEntry.Added_Count++;
                existingDetailEntry.Added_Points += entry.PlanEstimate;
            }
            else if (entry.ChangeType.indexOf("Removed") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Removed on " + displayDate;
                existingDetailEntry.Removed_Count++;
                existingDetailEntry.Removed_Points += entry.PlanEstimate; //(-1*(entry.PlanEstimate - items[exists].InitialPlanEstimate));                
            }
            else if (entry.ChangeType.indexOf("Resized") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Resized from " + (items[exists].PlanEstimate) + " to " + entry.PlanEstimate + " on " + displayDate;
                existingDetailEntry.Resized_Count++;
                existingDetailEntry.Resized_Points += (entry.PlanEstimate - items[exists].PlanEstimate);                
            }
            else if (entry.ChangeType.indexOf("Backlog") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Backlog on " + displayDate;
                existingDetailEntry.Backlog_Count++;
                existingDetailEntry.Backlog_Points += entry.PlanEstimate;                
            }
            else if (entry.ChangeType.indexOf("Defined") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Defined on " + displayDate;
                existingDetailEntry.Defined_Count++;
                existingDetailEntry.Defined_Points += entry.PlanEstimate;                
            }
            else if (entry.ChangeType.indexOf("In-Progress") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " In-Progress on " + displayDate;
                existingDetailEntry.InProgress_Count++;
                existingDetailEntry.InProgress_Points += entry.PlanEstimate;                
            }
            else if (entry.ChangeType.indexOf("Completed") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Completed on " + displayDate;
                existingDetailEntry.Completed_Count++;
                existingDetailEntry.Completed_Points += entry.PlanEstimate;                
            }
            else if (entry.ChangeType.indexOf("Accepted") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Accepted on " + displayDate;
                existingDetailEntry.Accepted_Count++;
                existingDetailEntry.Accepted_Points += entry.PlanEstimate;                
            }
            else if (entry.ChangeType.indexOf("Released") != -1)
            {
                items[exists][hoverID] = existingHoverEntry + " Released on " + displayDate;
                existingDetailEntry.Released_Count++;
                existingDetailEntry.Released_Points += entry.PlanEstimate;                
            }            

            items[exists][detailID] = existingDetailEntry;

            // store latest change type
            items[exists].ChangeType = entry.ChangeType;    

            // and the latest schedule state
            items[exists].CombinedState = entry.CombinedState;
            items[exists].State = entry.State;
            items[exists].ScheduleState = entry.ScheduleState;

            // update iteraiton level plan estimates
            items[exists][estID] = entry.PlanEstimate;   

            // update final planEstimate etc. with details from latest available revision
            items[exists].PlanEstimate = entry.PlanEstimate;

            // update delta totals
            items[exists].ChangeValue = entry.PlanEstimate - items[exists].InitialPlanEstimate;

        });

        items.forEach(function(item) {
            if (item.ChangeType == "Removed")
            {
                item.ReleaseScope = "Out of Scope";
                item.CombinedState = "Removed";
                if (item.state != "" && item.state != null)
                    item.ReleaseScope += "(" + item.State + ")";
            }
        });

        // setup the final summary objects
        var summary = [];
        var start = {Name: "Release Scope at Start", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var added = {Name: "Release Scope Added", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var removed = {Name: "Release Scope Removed", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var resized = {Name: "Release Scope Resized", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var backlog = {Name: "Total Backlog", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var defined = {Name: "Total Defined", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var inprogress = {Name: "Total In-Progress", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var completed = {Name: "Total Completed", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var accepted = {Name: "Release Scope Accepted", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var released = {Name: "Total Released", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var net = {Name: "Release Net Scope", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};
        var remain = {Name: "Release Scope Remaining", Iteration_Pre: {Count: 0, Points: 0}, Iteration_Post: {Count: 0, Points: 0}, Iteration_Total: {Count: 0, Points: 0}};

        for(i=0; i<iterations.length; i++){
            var iterationID = "Iteration_" + iterations[i].ID;
            start[iterationID] = {Count: 0, Points: 0};
            added[iterationID] = {Count: 0, Points: 0};
            removed[iterationID] = {Count: 0, Points: 0};
            resized[iterationID] = {Count: 0, Points: 0};
            backlog[iterationID] = {Count: 0, Points: 0};
            defined[iterationID] = {Count: 0, Points: 0};
            inprogress[iterationID] = {Count: 0, Points: 0};
            completed[iterationID] = {Count: 0, Points: 0};
            accepted[iterationID] = {Count: 0, Points: 0};
            released[iterationID] = {Count: 0, Points: 0};
            net[iterationID] = {Count: 0, Points: 0};
            remain[iterationID] = {Count: 0, Points: 0};
        }

        for(i=0;i<items.length;i++){
            var item = items[i];
            // for each item we need to trek across each iteraiton marker
            var detail = item.Detail_Pre;
            if(detail != null){
                // we have details, step through and update summary objects
                added["Iteration_Pre"].Count += detail.Added_Count;
                added["Iteration_Pre"].Points += detail.Added_Points;
                removed["Iteration_Pre"].Count += detail.Removed_Count;
                removed["Iteration_Pre"].Points += detail.Removed_Points;
                resized["Iteration_Pre"].Count += detail.Resized_Count;
                resized["Iteration_Pre"].Points += detail.Resized_Points;
                backlog["Iteration_Pre"].Count += detail.Backlog_Count;
                backlog["Iteration_Pre"].Points += detail.Backlog_Points;
                defined["Iteration_Pre"].Count += detail.Defined_Count;
                defined["Iteration_Pre"].Points += detail.Defined_Points;
                inprogress["Iteration_Pre"].Count += detail.InProgress_Count;
                inprogress["Iteration_Pre"].Points += detail.InProgress_Points;
                completed["Iteration_Pre"].Count += detail.Completed_Count;
                completed["Iteration_Pre"].Points += detail.Completed_Points;
                accepted["Iteration_Pre"].Count += detail.Accepted_Count;
                accepted["Iteration_Pre"].Points += detail.Accepted_Points;
                released["Iteration_Pre"].Count += detail.Released_Count;
                released["Iteration_Pre"].Points += detail.Released_Points;

                added["Iteration_Total"].Count += detail.Added_Count;
                added["Iteration_Total"].Points += detail.Added_Points;
                removed["Iteration_Total"].Count += detail.Removed_Count;
                removed["Iteration_Total"].Points += detail.Removed_Points;
                resized["Iteration_Total"].Count += detail.Resized_Count;
                resized["Iteration_Total"].Points += detail.Resized_Points;

                backlog["Iteration_Total"].Count += detail.Backlog_Count;
                backlog["Iteration_Total"].Points += detail.Backlog_Points;
                defined["Iteration_Total"].Count += detail.Defined_Count;
                defined["Iteration_Total"].Points += detail.Defined_Points;
                inprogress["Iteration_Total"].Count += detail.InProgress_Count;
                inprogress["Iteration_Total"].Points += detail.InProgress_Points;
                completed["Iteration_Total"].Count += detail.Completed_Count;
                completed["Iteration_Total"].Points += detail.Completed_Points;
                accepted["Iteration_Total"].Count += detail.Accepted_Count;
                accepted["Iteration_Total"].Points += detail.Accepted_Points;
                released["Iteration_Total"].Count += detail.Released_Count;
                released["Iteration_Total"].Points += detail.Released_Points;

                net["Iteration_Pre"].Count += (detail.Added_Count - detail.Removed_Count);
                net["Iteration_Total"].Count += (detail.Added_Count - detail.Removed_Count);
                remain["Iteration_Pre"].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);
                remain["Iteration_Total"].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);

                net["Iteration_Pre"].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                net["Iteration_Total"].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                remain["Iteration_Pre"].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);
                remain["Iteration_Total"].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);

            }            
            var detail = item.Detail_Post;
            if(detail != null){
                // we have details, step through and update summary objects
                added["Iteration_Post"].Count += detail.Added_Count;
                added["Iteration_Post"].Points += detail.Added_Points;
                removed["Iteration_Post"].Count += detail.Removed_Count;
                removed["Iteration_Post"].Points += detail.Removed_Points;
                resized["Iteration_Post"].Count += detail.Resized_Count;
                resized["Iteration_Post"].Points += detail.Resized_Points;
                
                backlog["Iteration_Post"].Count += detail.Backlog_Count;
                backlog["Iteration_Post"].Points += detail.Backlog_Points;
                defined["Iteration_Post"].Count += detail.Defined_Count;
                defined["Iteration_Post"].Points += detail.Defined_Points;
                inprogress["Iteration_Post"].Count += detail.InProgress_Count;
                inprogress["Iteration_Post"].Points += detail.InProgress_Points;
                completed["Iteration_Post"].Count += detail.Completed_Count;
                completed["Iteration_Post"].Points += detail.Completed_Points;
                accepted["Iteration_Post"].Count += detail.Accepted_Count;
                accepted["Iteration_Post"].Points += detail.Accepted_Points;
                released["Iteration_Post"].Count += detail.Released_Count;
                released["Iteration_Post"].Points += detail.Released_Points;

                added["Iteration_Total"].Count += detail.Added_Count;
                added["Iteration_Total"].Points += detail.Added_Points;
                removed["Iteration_Total"].Count += detail.Removed_Count;
                removed["Iteration_Total"].Points += detail.Removed_Points;
                resized["Iteration_Total"].Count += detail.Resized_Count;
                resized["Iteration_Total"].Points += detail.Resized_Points;

                backlog["Iteration_Total"].Count += detail.Backlog_Count;
                backlog["Iteration_Total"].Points += detail.Backlog_Points;
                defined["Iteration_Total"].Count += detail.Defined_Count;
                defined["Iteration_Total"].Points += detail.Defined_Points;
                inprogress["Iteration_Total"].Count += detail.InProgress_Count;
                inprogress["Iteration_Total"].Points += detail.InProgress_Points;
                completed["Iteration_Total"].Count += detail.Completed_Count;
                completed["Iteration_Total"].Points += detail.Completed_Points;
                accepted["Iteration_Total"].Count += detail.Accepted_Count;
                accepted["Iteration_Total"].Points += detail.Accepted_Points;    
                released["Iteration_Total"].Count += detail.Released_Count;
                released["Iteration_Total"].Points += detail.Released_Points;

                net["Iteration_Post"].Count += (detail.Added_Count - detail.Removed_Count);
                net["Iteration_Total"].Count += (detail.Added_Count - detail.Removed_Count);
                remain["Iteration_Post"].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);
                remain["Iteration_Total"].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);

                net["Iteration_Post"].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                net["Iteration_Total"].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                remain["Iteration_Post"].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);
                remain["Iteration_Total"].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);


            }      
            for(j=0;j<this.visibleIterations.length;j++){
                var iterationID = this.visibleIterations[j].ID;
                var detail = item["Detail_" + iterationID];
                if(detail != null){
                    // we have details, step through and update summary objects
                    added["Iteration_" + iterationID].Count += detail.Added_Count;
                    added["Iteration_" + iterationID].Points += detail.Added_Points;
                    removed["Iteration_" + iterationID].Count += detail.Removed_Count;
                    removed["Iteration_" + iterationID].Points += detail.Removed_Points;
                    resized["Iteration_" + iterationID].Count += detail.Resized_Count;
                    resized["Iteration_" + iterationID].Points += detail.Resized_Points;
                    
                    backlog["Iteration_" + iterationID].Count += detail.Backlog_Count;
                    backlog["Iteration_" + iterationID].Points += detail.Backlog_Points;
                    defined["Iteration_" + iterationID].Count += detail.Defined_Count;
                    defined["Iteration_" + iterationID].Points += detail.Defined_Points;
                    inprogress["Iteration_" + iterationID].Count += detail.InProgress_Count;
                    inprogress["Iteration_" + iterationID].Points += detail.InProgress_Points;
                    completed["Iteration_" + iterationID].Count += detail.Completed_Count;
                    completed["Iteration_" + iterationID].Points += detail.Completed_Points;
                    accepted["Iteration_" + iterationID].Count += detail.Accepted_Count;
                    accepted["Iteration_" + iterationID].Points += detail.Accepted_Points;
                    released["Iteration_" + iterationID].Count += detail.Released_Count;
                    released["Iteration_" + iterationID].Points += detail.Released_Points;

                    added["Iteration_Total"].Count += detail.Added_Count;
                    added["Iteration_Total"].Points += detail.Added_Points;
                    removed["Iteration_Total"].Count += detail.Removed_Count;
                    removed["Iteration_Total"].Points += detail.Removed_Points;
                    resized["Iteration_Total"].Count += detail.Resized_Count;
                    resized["Iteration_Total"].Points += detail.Resized_Points;
                    
                    backlog["Iteration_Total"].Count += detail.Backlog_Count;
                    backlog["Iteration_Total"].Points += detail.Backlog_Points;
                    defined["Iteration_Total"].Count += detail.Defined_Count;
                    defined["Iteration_Total"].Points += detail.Defined_Points;
                    inprogress["Iteration_Total"].Count += detail.InProgress_Count;
                    inprogress["Iteration_Total"].Points += detail.InProgress_Points;
                    completed["Iteration_Total"].Count += detail.Completed_Count;
                    completed["Iteration_Total"].Points += detail.Completed_Points;
                    accepted["Iteration_Total"].Count += detail.Accepted_Count;
                    accepted["Iteration_Total"].Points += detail.Accepted_Points;      
                    released["Iteration_Total"].Count += detail.Released_Count;
                    released["Iteration_Total"].Points += detail.Released_Points;

                    net["Iteration_" + iterationID].Count += (detail.Added_Count - detail.Removed_Count);
                    net["Iteration_Total"].Count += (detail.Added_Count - detail.Removed_Count);
                    remain["Iteration_" + iterationID].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);
                    remain["Iteration_Total"].Count += (detail.Added_Count - detail.Accepted_Count - detail.Removed_Count);

                    net["Iteration_" + iterationID].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                    net["Iteration_Total"].Points += (detail.Added_Points - detail.Removed_Points + detail.Resized_Points);
                    remain["Iteration_" + iterationID].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);
                    remain["Iteration_Total"].Points += (detail.Added_Points - detail.Accepted_Points - detail.Removed_Points + detail.Resized_Points);
                }
            }
        }

        var cumulative = [];
        cumulative[0] = "Iteration_Pre";
        for(i=0;i<this.visibleIterations.length;i++){
            cumulative.push(this.visibleIterations[i].ColumnID);
        }
        cumulative.push("Iteration_Post");

        // update cumulative totals
        for(i=1; i<cumulative.length; i++){
            var name = cumulative[i];
            var last_name = cumulative[i-1];
            remain[name].Count = remain[last_name].Count + added[name].Count - removed[name].Count - accepted[name].Count;
            remain[name].Points = remain[last_name].Points + added[name].Points + resized[name].Points - removed[name].Points - accepted[name].Points;
            start[name].Count = remain[last_name].Count;
            start[name].Points = remain[last_name].Points;
        }

        // add to grid display
        summary.push(start);
        summary.push(added);
        summary.push(removed);
        summary.push(resized);

        if (this.ignore_schedule_states.indexOf("Backlog") == -1)
            summary.push(backlog);
        if (this.ignore_schedule_states.indexOf("Defined") == -1)
            summary.push(defined);
        if (this.ignore_schedule_states.indexOf("In-Progress") == -1)
            summary.push(inprogress);
        // CM hide completed from top view
        // if (this.ignore_schedule_states.indexOf("Completed") == -1)
        //    summary.push(completed);
        
        summary.push(net);

        if (this.ignore_schedule_states.indexOf("Accepted") == -1)
            summary.push(accepted);
        if (this.ignore_schedule_states.indexOf("Released") == -1)
            summary.push(released);
        
        summary.push(remain);

        this.iteration_change_summaries = summary;
        return items;
    },
    _getIdFromSnap: function(snap){
        var type_hierarchy = snap.get('_TypeHierarchy');
        var type = type_hierarchy[type_hierarchy.length - 1 ];
        return this.prefixes[type] + snap.get('_UnformattedID');
    },
    _getChangeTypeFromSnap: function(snap){
        var change_type = false;
        
        var previous_release = snap.get("_PreviousValues").Release;
        var release = snap.get("Release");
        
        var type_hierarchy = snap.get('_TypeHierarchy');
        var type = type_hierarchy[type_hierarchy.length - 1 ];
        var id = this._getIdFromSnap(snap);
        
        var previous_size = snap.get("_PreviousValues")[this.alternate_pi_size_field];
        var size = snap.get(this.alternate_pi_size_field) || 0;
        
        var previous_schedule_state = snap.get("_PreviousValues").ScheduleState;
        var schedule_state = snap.get("ScheduleState");

        if ( previous_release === null && Ext.Array.indexOf(this.release_oids,release) > -1 ) {
            change_type = "Added";
        } else if ( Ext.Array.indexOf(this.release_oids,release) > -1 && 
            Ext.Array.indexOf(this.release_oids,previous_release) === -1 &&
            typeof previous_release !== "undefined" ) {
            change_type = "Added";
        } else if ( release === "" && 
            Ext.Array.indexOf(this.release_oids,previous_release) !== -1) {
            change_type = "Removed";
        } else if ( Ext.Array.indexOf(this.release_oids,release) == -1 && 
             Ext.Array.indexOf(this.release_oids,previous_release) !== -1 ) {
            change_type = "Removed";
        } else if ( Ext.Array.indexOf(this.release_oids,release) > -1 &&
            size !== previous_size && 
            typeof previous_size !== "undefined") {
            change_type = "Resized";
        }
        
        // CM add in schedule changes
        if (previous_schedule_state != schedule_state)
        {
            if (previous_schedule_state == null || previous_schedule_state == 'undefined')
                schedule_state_change = schedule_state;    
            else
                schedule_state_change = schedule_state;

            // filter out excluded schedule states - we don't want to see these in the grid
            if (this.ignore_schedule_states.indexOf(schedule_state) != -1)
                schedule_state_change = "";

            if (change_type == false)
            {
                // this is an explicit schedule state change with no related release change
                change_type = schedule_state_change;             
            }
            else
            {
                // release change AND a schedule change
                if (change_type != "Removed")
                {
                    if (schedule_state_change != "")
                    {
                        change_type += "<br/>" + schedule_state_change; // only show if last action is not removed.
                    }
                }
            }
        }

        var change_date = Rally.util.DateTime.toIsoString(Rally.util.DateTime.fromIsoString(snap.get('_ValidFrom')));
        this.logger.log("Change type", id, change_date, change_type, snap);
        return change_type;
    },
    _makeGrids: function(changes) {
        this._makeIterationSummaryGrid();
        this._makeDetailGrid(changes);
        return [];
    },
    _makeIterationSummaryGrid: function(){
        this.logger.log("_makeIterationSummaryGrid",this.iteration_change_summaries);
        var iteration_changes = this.iteration_change_summaries;
        this.setLoading(false);
        var store = Ext.create('Rally.data.custom.Store',{
            data: iteration_changes,
            limit: 'Infinity',
            pageSize: 5000,
        });
        var grid = {
            xtype:'rallygrid',
            store:store,
            showPagingToolbar: false,
            columnCfgs: [
                {text:'',dataIndex:'', width: 60},
                {text:'Name',dataIndex:'Name', flex: 1},
                {text:'',dataIndex:'', width: 50},                
                {text:'',dataIndex:'', width: 50},
                {text:'', dataIndex: ''},
                {text:'', dataIndex: ''},
                {text:'',dataIndex:'', width: 40},                
                {text:'Pre',dataIndex:'Iteration_Pre',renderer: this._subObjectPoints},
            ],
        };

        var me = this;
        Ext.Array.each(this.visibleIterations, function(iteration){
            var from = Rally.util.DateTime.toIsoString(iteration.StartDate).replace(/T.*$/,"");
            var to = Rally.util.DateTime.toIsoString(iteration.EndDate).replace(/T.*$/,"");
            var colName = iteration.Name;
            grid.columnCfgs.push({text:colName, dataIndex:iteration.ColumnID, renderer: me._subObjectPoints});
        });

        grid.columnCfgs.push({text:"Post", dataIndex:'Iteration_Post', renderer: this._subObjectPoints});
        grid.columnCfgs.push({text:"Total", dataIndex:'Iteration_Total', renderer: this._subObjectPoints});

        if ( this.iteration_summary_grid ) { this.iteration_summary_grid.destroy(); }
        this.iteration_summary_grid = this.down('#iteration_summary_grid').add(grid);
        
        return [];
    },
    _subObjectCount: function(val) {
        return val.Count;
    },
    _subObjectPoints: function(val) {
        //var html = "<div class='summary-wrapper'><div class='summary-left'>" + val.Count + "</div>" + "<div class='summary-right'>" + val.Points + "</div></div>"
        var html = "<div class='summary-wrapper'>" + "<div class='summary-center'>" + val.Points + "</div></div>"
        return html;
    },    
    _makeDetailGrid: function(changes){
        this.logger.log("_makeDetailGrid",changes);
        this.setLoading(false);
        var store = Ext.create('Rally.data.custom.Store',{
            data: changes,
            limit: 'Infinity',
            pageSize: 5000,
            /* 
                CM remove grouping for now 
                groupField: 'ChangeDate', 
            */
            /*
            sorters: [
                { 
                    property: 'ChangeDate',
                    direction: 'DESC'
                },
                {
                    property: 'timestamp',
                    direction: 'DESC'
                }
            ]
            */

            sorters: [{
                sorterFn: function(o1, o2){
                    var getRank = function(o){
                        var rank = 0;
                        var scope = o.get('ReleaseScope');
                        var size = o.get('PlanEstimate');
                        var state = o.get('ScheduleState');

                        if (scope === 'In Scope')
                        {
                            rank = 10; // in scope
                            if (size == 0) // unsized, now at risk
                                if (state === 'Released' || state === 'Accepted') // unsized but work already done
                                    rank = 10;
                                else // unsized and work NOT done
                                    rank = 20;
                        }
                        else if (scope === 'In Scope' && size == 0)
                            rank = 20; // in scope but not sized - AT RISK!   
                        else // out of scope
                            rank = 30;

                        
                        if (state === 'Released') 
                            rank += 1;
                        if (state === 'Accepted') 
                            rank += 2;
                        else if (state === 'Completed') 
                            rank += 3;
                        else if (state === 'Defined') 
                            rank += 4;
                        else if (state === 'Backlog') 
                            rank += 5;
                        return rank;
                    },
                    rank1 = getRank(o1),
                    rank2 = getRank(o2);

                    if (rank1 === rank2) {
                        return 0;
                    }

                    return rank1 < rank2 ? -1 : 1;
                }
            },
                { 
                    property: 'ChangeDate',
                    direction: 'ASC'
                },
                {
                    property: 'timestamp',
                    direction: 'ASC'
                }
            ],

/*
            sorters: [
                { 
                    property: 'ReleaseScope',
                    direction: 'ASC'
                },
                {
                    property: 'ScheduleState',
                    direction: 'DESC'
                }
            ]
*/

        });
        
        var id_renderer = this._renderID;
        
        /* CM moved grid creation out so we can add dynamic iteration columns */
        var grid = {
            xtype:'rallygrid',
            store:store,
            showPagingToolbar: false,
            features: [{
                ftype:'grouping',
                groupHeaderTpl: '{name}',
                ftype: 'summary'
            }],
            viewConfig: {
                getRowClass: function(record, rowIndex, rp, ds){ 
                    return 'x-grid-row-outofscope';
                }
            },         
            columnCfgs: [
                {text:'id',dataIndex:'FormattedID', width: 60,renderer: id_renderer},
                {text:'Name',dataIndex:'Name',flex:1},
                {text:'Initial Size',dataIndex:'InitialPlanEstimate', width: 50, summaryType: 'sum'},                
                {text:'Current Size',dataIndex:'PlanEstimate', width: 50, summaryType: 'sum'},
                {text:'Release Scope', dataIndex: 'ReleaseScope'},
                {text:'State', dataIndex: 'CombinedState'},
                {text:'Delta',dataIndex:'ChangeValue', width: 40, summaryType: 'sum'},
                {text:'Pre',dataIndex:'Iteration_Pre'},
            ],
            listeners: {
                beforerender: function(cmp) {
                    cmp.view.getRowClass = function(record, index, rowParams, store) {
                        var css = "";
                        var scope = record.get('ReleaseScope');
                        var state = record.get('CombinedState');
                        var size = record.get('PlanEstimate');

                        if (scope == "Out of Scope")
                            css = 'x-grid-row-outofscope';
                        else if (state.indexOf('Accepted') != -1 || state.indexOf('Released') != -1)
                            css = 'x-grid-row-accepted';
                        else if (size == 0)
                            css = 'x-grid-row-atrisk';
                        else
                            css = 'x-grid-row-notdone';
                        return css;
                    };
                },
                scope: this,
                cellclick: this._onCellClick
            }
        };
        Ext.Array.each(this.visibleIterations, function(iteration){
            var from = Rally.util.DateTime.toIsoString(iteration.StartDate).replace(/T.*$/,"");
            var to = Rally.util.DateTime.toIsoString(iteration.EndDate).replace(/T.*$/,"");
            var colName = iteration.Name;
            grid.columnCfgs.push({text:colName, dataIndex:iteration.ColumnID});
        });

        grid.columnCfgs.push({text:"Post", dataIndex:'Iteration_Post'});
        // added to match number of columns in headers...
        grid.columnCfgs.push({text:"", dataIndex:''});

        if ( this.detail_grid ) { this.detail_grid.destroy(); }
        this.detail_grid = this.down('#daily_box').add(grid);
        
        return [];
    },
    _renderID: function(value,cellData,record,rowIndex,colIndex,store,view) {
        return Rally.nav.DetailLink.getLink({
            record: record.getData(),
            text: record.get('FormattedID')
        });
        
        //return "<a target='_top' href='" + Rally.nav.Manager.getDetailUrl(record) + "'>" + value + "</a>";
    },
    _onCellClick: function(grid, cell, cellIndex, record, tr, rowIndex, e, eOpts ){
        if ( cellIndex === 5 ) {
            var spanner = Ext.create('Ext.container.Container',{
                html: "Loading..."
            });
            var popover = Ext.create('Rally.ui.popover.Popover',{
                target: Ext.get(cell),
                items: [ spanner ]
            });
            this._getRevisionInformation(record,spanner);
        }
        else if( cellIndex > 6 ) {
            var spanner = Ext.create('Ext.container.Container',{
                html: "Loading iteration details..."
            });
            var popover = Ext.create('Rally.ui.popover.Popover',{
                target: Ext.get(cell),
                items: [ spanner ]
            });
            this._getItemRevisionInformation(record,spanner,cellIndex);
        }
    },
    _getRevisionInformation: function(record,spanner){
        var me = this;
        var timestamp = record.get('timestamp').replace(/\.\d\d\d/,"");
        var store = Ext.create('Rally.data.wsapi.Store',{
            model:record.get('_type'),
            filters: [{property:'ObjectID',value:record.get('ObjectID')}],
            fetch: ['ObjectID','RevisionHistory'],
            autoLoad: true,
            listeners: {
                scope: this,
                load: function(store,pis){
                    Rally.data.ModelFactory.getModel({
                        type:'RevisionHistory',
                        success:function(model){
                            model.load(pis[0].get('RevisionHistory').ObjectID,{
                                fetch:['Revisions'],
                                callback:function(result,operation){
                                    result.getCollection('Revisions').load({
                                        autoLoad: true,
                                        scope: this,
                                        callback: function(revisions, operation, success ) {
                                            var messages = [];
                                            Ext.Array.each(revisions,function(rev){
                                                var under_creation = Rally.util.DateTime.toIsoString(Rally.util.DateTime.add(rev.get('CreationDate'),"minute",-1),true);                                                
                                                var over_creation = Rally.util.DateTime.toIsoString(Rally.util.DateTime.add(rev.get('CreationDate'),"minute",1),true);                                                
                                                console.log(rev.get('RevisionNumber'),timestamp,under_creation,over_creation);
                                                if ( timestamp.localeCompare(over_creation) == -1 && timestamp.localeCompare(under_creation) == 1 ){
                                                    console.log('---');
                                                    messages.push("Rev " + rev.get('RevisionNumber') + 
                                                        " (" + rev.get('User')._refObjectName + "):<br/>" +
                                                        rev.get('Description') );
                                                    console.log(messages);
                                                    
                                                }
                                            });
                                            spanner.update(messages.join('<br/>'));
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            }
        });
    },
    _getItemRevisionInformation: function(record, spanner, cellIndex){

        var column = "";
        var offset = this.iterationColumn + 1;

        if (cellIndex == this.iterationColumn)
            column = "Hover_Pre";
        else if (cellIndex == this.visibleIterations.length + offset)
            column = "Hover_Post";
        else
            column = "Hover_" + this.visibleIterations[cellIndex - offset].ID;

        var text = record.get(column);
        spanner.update(text);
    }
});