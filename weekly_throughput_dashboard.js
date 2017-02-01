Ext.define('ZzacksWeeklyThroughputDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',

  getUserSettingsFields: function() {
    return [];
  },

  onSettingsUpdate: function(settings) {
    console.log('Changed settings:', settings);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    this.project_oid = this.getContext().getProject().ObjectID;
    var start_date = this.calculate_first_date();
    this.fetch_stories({}, start_date, 52);
  },

  calculate_first_date: function() {
    var the_date = new Date();
    the_date.setDate(the_date.getDate() - 365);

    while (the_date.getDay() > 0) {
      the_date.setDate(the_date.getDate() - 1);
    }
    the_date.setHours(0, 0, 0, 0);

    return the_date;
  },

  fetch_stories: function(counts, start_date, count) {
    this._mask.msg = 'Fetching stories... (' + count + ' weeks left)';
    this._mask.show();

    var end_date = new Date(start_date);
    end_date.setDate(end_date.getDate() + 7);

    var that = this;
    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      filters: [
        {
          property: 'AcceptedDate',
          operator: '>=',
          value: start_date
        },
        {
          property: 'AcceptedDate',
          operator: '<',
          value: end_date
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          var d = start_date.toDateString();
          counts[d] = {
            total_story_pts: 0,
            total_stories: 0,
            total_defect_pts: 0,
            total_defects: 0
          };
          records.forEach(function(r) {
            if (r.get('_type') == 'hierarchicalrequirement') {
              counts[d].total_story_pts += r.get('PlanEstimate');
              counts[d].total_stories += 1;
            } else if (r.get('_type') == 'defect') {
              counts[d].total_defect_pts += r.get('PlanEstimate');
              counts[d].total_defects += 1;
            }
          });
        }

        if (end_date < new Date()) {
          that.fetch_stories(counts, end_date, count - 1);
        } else {
          that.removeAll();
          that.create_options(counts);
        }
      }
    });
  },

  create_options: function(counts) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a>'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'mode_select',
      fieldLabel: 'Combine stories & defects?',
      store: ['Separate', 'Combined'],
      listeners: { change: {
        fn: that.change_graph_mode.bind(that)
      }}
    });

    this.counts = counts;
    this.build_graph(counts, 'Separate');
  },

  build_graph(counts, mode) {
    this._mask.msg = 'Building graph...';
    this._mask.show();

    var combined = mode == 'Combined';

    var data = {
      series: [],
      categories: []
    };
    if (!combined) {
      data.series = [
        {
          name: 'Stories',
          data: []
        },
        {
          name: 'Defects',
          data: []
        }
      ];
    } else {
      data.series = [
        {
          name: 'Artifacts',
          data: []
        }
      ];
    }

    Object.keys(counts).forEach(function(d) {
      data.categories.push(d);
      if (!combined) {
        data.series[0].data.push({
          y: counts[d].total_stories,
          date: d,
          unit: 'stories'
        });
        data.series[1].data.push({
          y: counts[d].total_defects,
          date: d,
          unit: 'defects'
        });
      } else {
        data.series[0].data.push({
          y: counts[d].total_stories + counts[d].total_defects,
          date: d,
          unit: 'artifacts'
        });
      }
    });

    this.chart = this.add({
      xtype: 'rallychart',
      chartData: data,
      chartConfig: {
        chart: {
          type: 'line'
        },
        title: { text: 'Stories/defects accepted per week' },
        // subtitle: { text: 'subtitle' },
        xAxis: {
          title: { text: 'Week of...' },
          labels: {
            formatter: function() {
              return new Date(this.value).toDateString();
            },
            step: 2,
            rotation: -65
          }
        },
        yAxis: {
          title: { text: 'Artifacts accepted' },
          min: 0
        },
        tooltip: {
          pointFormat:
            '{point.date}<br />' +
            '<b>{point.y} {point.unit}</b>',
          headerFormat: ''
        }
      }
    });

    this._mask.hide();
  },

  change_graph_mode: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.remove(this.chart);
      this.build_graph(this.counts, new_item);
    }
  }
});