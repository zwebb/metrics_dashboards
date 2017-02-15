Ext.define('ZzacksCumulativeWorkDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  
  getUserSettingsFields: function() {
    return [];
  },

  onSettingsUpdate: function(settings) {
    console.log('Settings update:', settings);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    var that = this;
    this.start(function() {
      that.ts = that.getContext().getTimeboxScope();
      that.release = {
        name: that.ts.record.raw.Name,
        start_date: that.ts.record.raw.ReleaseStartDate,
        end_date: that.ts.record.raw.ReleaseDate
      };
      that.fetch_artifacts([], that.release, 'UserStory');
    });
  },

  onTimeboxScopeChange: function(ts) {
    this._mask.show();
    var that = this;
    this.start(function() {
      that.ts = ts;
      that.release = {
        name: that.ts.record.raw.Name,
        start_date: that.ts.record.raw.ReleaseStartDate,
        end_date: that.ts.record.raw.ReleaseDate
      };
      that.fetch_artifacts([], that.release, 'UserStory');
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_artifacts([], that.release, 'UserStory');
    });
  },

  start: function(call_thru) {
    if (this.locked) {
      alert("Please wait for the calculation to finish before starting a new calculation.\n\nIf you tried to change the timebox scope, you will need to re-select the scope you're trying to look at.");
    } else {
      this.locked = true;
      call_thru();
    }
  },

  haltEarly: function(msg) {
    this._mask.hide();
    this.removeAll();
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
  },

  fetch_artifacts: function(artifacts, release, type) {
    this._mask.msg = 'Fetching artifacts...';
    this._mask.show();
    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: [type],
      fetch: ['PlanEstimate', '_type', 'Tags', 'AcceptedDate'],
      filters: [
        {
          property: 'AcceptedDate',
          operator: '>=',
          value: release.start_date
        },
        {
          property: 'AcceptedDate',
          operator: '<',
          value: release.end_date
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      limit: 1500,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Artifacts query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          records.forEach(function(r) {
            if (r.get('_type') == 'hierarchicalrequirement') {
              r.t = 'Story';
            } else if (r.get('_type') == 'defect') {
              var is_cv = r.get('Tags')._tagsNameArray.filter(function(o) {
                return o.Name == 'Customer Voice';
              }).length > 0;
              var tag_names = r.get('Tags')._tagsNameArray.map(function(o) {
                return o.Name;
              });
              if (is_cv) {
                r.t = 'CV Defect';
              } else {
                r.t = 'Defect';
              }
            }
          });
          artifacts = artifacts.concat(records);
          if (type == 'UserStory') {
            that.fetch_artifacts(artifacts, release, 'Defect');
          } else {
            that.calculate_deltas(artifacts, release);
          }
        } else {
          that.haltEarly('No artifacts found for this release.');
        }
      }
    });
  },

  calculate_deltas: function(artifacts, release) {
    this._mask.msg = 'Calculating release deltas...';
    this._mask.show();
    var that = this;

    var deltas = {};
    var now = new Date();
    if (new Date(release.end_date) < now) {
      now = new Date(release.end_date);
    }
    for (var d = new Date(release.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      deltas[d.toDateString()] = {
        ap: {},
        as: {}
      };
    }

    var types = [];
    artifacts.forEach(function(s) {
      var a_date = s.get('AcceptedDate').toDateString();
      var type = s.t;
      //var type = s.get('_type');
      // change type here to color-code by feature

      if (!types.includes(type)) {
        types.push(type);
      }

      if (a_date && type && deltas[a_date]) {
        if (deltas[a_date].ap[type]) {
          deltas[a_date].ap[type] += s.get('PlanEstimate');
          deltas[a_date].as[type] += 1;
        } else {
          deltas[a_date].ap[type] = s.get('PlanEstimate');
          deltas[a_date].as[type] = 1;
        }
      } else {
        console.log('Weird story!', a_date, type, s);
      }
    });

    Object.keys(deltas).forEach(function(d) {
      types.forEach(function(t) {
        if (!deltas[d].ap[t]) {
          deltas[d].ap[t] = 0;
          deltas[d].as[t] = 0;
        }
      });
    });

    var d_first = Object.keys(deltas)[0];
    for (var i = 0; i < Object.keys(deltas).length - 1; i += 1) {
      var d_prev = Object.keys(deltas)[i];
      var d_next = Object.keys(deltas)[i + 1];
      types.forEach(function(t) {
        deltas[d_next].ap[t] += deltas[d_prev].ap[t];
        deltas[d_next].as[t] += deltas[d_prev].as[t];
      });
    }

    that.removeAll();
    that.create_options(deltas, types);
  },
  
  create_options: function(deltas, types) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_all_work()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'graph_select',
      fieldLabel: 'Y-axis:',
      store: ['Total points', 'Total stories/defects'],
      listeners: { change: {
        fn: that.change_graph_type.bind(that)
      }}
    });

    that.deltas = deltas;
    that.types = types;
    that.build_charts(deltas, types, 'Total points');
  },

  build_charts: function(deltas, types, graph_type) {
    this._mask.msg = 'Building chart...';
    this._mask.show();
    var that = this;

    var points = graph_type == 'Total points';

    var series = [];
    types.forEach(function(t) {
      var data = [];

      Object.keys(deltas).forEach(function(d) {
        data.push({
          y: points ?
            deltas[d].ap[t] :
            deltas[d].as[t],
          date: d,
          x: new Date(d).getTime()
        });
      });

      series.push({
        name: t,
        data: data
      });
    });

    var chart_config = {
      chart: { type: 'area' },
      xAxis: {
        title: { text: 'Date' },
        max: new Date(Object.keys(deltas)[Object.keys(deltas).length - 1]).getTime(),
        min: new Date(Object.keys(deltas)[0]).getTime(),
        labels: {
          formatter: function() {
            return new Date(this.value).toDateString();
          },
          rotation: -20
        }
      },
      plotOptions: {
        area: {
          stacking: 'normal',
          lineColor: '#000000',
          lineWidth: 1,
          marker: { enabled: false }
        }
      }
    };
    var tooltip_header = '<span style="font-size: 10px">{series.name}</span><br/>';
    var tooltip_point = '<b>{point.y} {unit}</b><br />on {point.date}';

    that.chart = that.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: {
        series: series
      },
      chartConfig: Object.assign(
        {
          title: { text: (points ? 'Points' : 'Stories/defects') + ' accepted per quarter' },
          yAxis: { 
            title: { text: 'Total ' + (points ? 'points' : 'artifacts') },
            min: 0
          },
          tooltip: {
            headerFormat: tooltip_header,
            pointFormat: tooltip_point.replace('{unit}', points ? 'points' : 'artifacts')
          }
        },
        chart_config
      )
    });

    that._mask.hide();
    that.locked = false;
  },

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.graph_type = new_item;
      this.remove(this.chart);
      this.build_charts(this.deltas, this.types, new_item);
    }
  }
});
