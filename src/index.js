// Generated by LiveScript 1.5.0
/**
 * @package Detox routing
 * @author  Nazar Mokrynskyi <nazar@mokrynskyi.com>
 * @license 0BSD
 */
(function(){
  var PUBLIC_KEY_LENGTH, MAC_LENGTH, ROUTER_PACKET_SIZE;
  PUBLIC_KEY_LENGTH = 32;
  MAC_LENGTH = 16;
  ROUTER_PACKET_SIZE = 512 - 3;
  function Wrapper(detoxCrypto, detoxTransport, detoxUtils, ronion, fixedSizeMultiplexer, asyncEventer){
    var are_arrays_equal, concat_arrays, ArrayMap, timeoutSet, MAX_DATA_SIZE;
    are_arrays_equal = detoxUtils['are_arrays_equal'];
    concat_arrays = detoxUtils['concat_arrays'];
    ArrayMap = detoxUtils['ArrayMap'];
    timeoutSet = detoxUtils['timeoutSet'];
    MAX_DATA_SIZE = detoxTransport['MAX_DATA_SIZE'];
    /**
     * @constructor
     *
     * @param {!Uint8Array}	dht_private_key					X25519 private key that corresponds to Ed25519 key used in `DHT` constructor (from `@detox/dht` package)
     * @param {number}		max_pending_segments			How many segments can be in pending state per one address
     * @param {number=}		routing_path_segment_timeout	Max time in seconds allowed for routing path segment creation after which creation is considered failed
     *
     * @return {!Router}
     *
     * @throws {Error}
     */
    function Router(dht_private_key, max_pending_segments, routing_path_segment_timeout){
      var this$ = this;
      max_pending_segments == null && (max_pending_segments = 10);
      routing_path_segment_timeout == null && (routing_path_segment_timeout = 10);
      if (!(this instanceof Router)) {
        return new Router(dht_private_key, max_pending_segments, routing_path_segment_timeout);
      }
      asyncEventer.call(this);
      this._routing_path_segment_timeout = routing_path_segment_timeout;
      this._encryptor_instances = ArrayMap();
      this._rewrapper_instances = ArrayMap();
      this._last_node_in_routing_path = ArrayMap();
      this._multiplexers = ArrayMap();
      this._demultiplexers = ArrayMap();
      this._established_routing_paths = ArrayMap();
      this._ronion = ronion(ROUTER_PACKET_SIZE, PUBLIC_KEY_LENGTH, MAC_LENGTH, max_pending_segments);
      this._max_packet_data_size = this._ronion['get_max_command_data_length']();
      this._ronion['on']('activity', function(address, segment_id){
        this$['fire']('activity', address, segment_id);
      })['on']('create_request', function(address, segment_id, command_data){
        var source_id, encryptor_instance, e, rewrapper_instance, encryptor_instances, rewrapper_instances;
        if (this$._destroyed) {
          return;
        }
        source_id = concat_arrays([address, segment_id]);
        if (this$._encryptor_instances.has(source_id)) {
          return;
        }
        encryptor_instance = detoxCrypto['Encryptor'](false, dht_private_key);
        try {
          encryptor_instance['put_handshake_message'](command_data);
        } catch (e$) {
          e = e$;
          return;
        }
        this$._ronion['create_response'](address, segment_id, encryptor_instance['get_handshake_message']());
        this$._ronion['confirm_incoming_segment_established'](address, segment_id);
        this$._multiplexers.set(source_id, fixedSizeMultiplexer['Multiplexer'](MAX_DATA_SIZE, this$._max_packet_data_size));
        this$._demultiplexers.set(source_id, fixedSizeMultiplexer['Demultiplexer'](MAX_DATA_SIZE, this$._max_packet_data_size));
        if (!encryptor_instance['ready']()) {
          return;
        }
        rewrapper_instance = encryptor_instance['get_rewrapper_keys']().map(detoxCrypto['Rewrapper']);
        encryptor_instances = ArrayMap();
        encryptor_instances.set(address, encryptor_instance);
        rewrapper_instances = ArrayMap();
        rewrapper_instances.set(address, rewrapper_instance);
        this$._encryptor_instances.set(source_id, encryptor_instances);
        this$._rewrapper_instances.set(source_id, rewrapper_instances);
        this$._last_node_in_routing_path.set(source_id, address);
      })['on']('send', function(address, packet){
        this$['fire']('send', address, packet);
      })['on']('data', function(address, segment_id, target_address, command, command_data){
        var source_id, last_node_in_routing_path, demultiplexer, data;
        if (this$._destroyed) {
          return;
        }
        source_id = concat_arrays([address, segment_id]);
        last_node_in_routing_path = this$._last_node_in_routing_path.get(source_id);
        if (!are_arrays_equal(target_address, last_node_in_routing_path)) {
          return;
        }
        demultiplexer = this$._demultiplexers.get(source_id);
        if (!demultiplexer) {
          return;
        }
        demultiplexer['feed'](command_data);
        if (demultiplexer['have_more_data']()) {
          data = demultiplexer['get_data']();
          this$['fire']('data', address, segment_id, command, data);
        }
      })['on']('encrypt', function(data){
        var address, segment_id, target_address, plaintext, source_id, encryptor_instance, ref$;
        if (this$._destroyed) {
          return;
        }
        address = data['address'];
        segment_id = data['segment_id'];
        target_address = data['target_address'];
        plaintext = data['plaintext'];
        source_id = concat_arrays([address, segment_id]);
        encryptor_instance = (ref$ = this$._encryptor_instances.get(source_id)) != null ? ref$.get(target_address) : void 8;
        if (!encryptor_instance || !encryptor_instance['ready']()) {
          return;
        }
        data['ciphertext'] = encryptor_instance['encrypt'](plaintext);
      })['on']('decrypt', function(data){
        var address, segment_id, target_address, ciphertext, source_id, encryptor_instance, ref$, e;
        if (this$._destroyed) {
          return;
        }
        address = data['address'];
        segment_id = data['segment_id'];
        target_address = data['target_address'];
        ciphertext = data['ciphertext'];
        source_id = concat_arrays([address, segment_id]);
        encryptor_instance = (ref$ = this$._encryptor_instances.get(source_id)) != null ? ref$.get(target_address) : void 8;
        if (!encryptor_instance || !encryptor_instance['ready']()) {
          return;
        }
        try {
          data['plaintext'] = encryptor_instance['decrypt'](ciphertext);
        } catch (e$) {
          e = e$;
          /**
           * Since we don't use all of Ronion features and only send data between initiator and responder, we can destroy unnecessary encryptor
           * instances and don't even try to decrypt anything, which makes data forwarding less CPU intensive
           */
          encryptor_instance['destroy']();
          this$._encryptor_instances.get(source_id)['delete'](target_address);
        }
      })['on']('wrap', function(data){
        var address, segment_id, target_address, unwrapped, source_id, rewrapper_instance, ref$, ref1$;
        if (this$._destroyed) {
          return;
        }
        address = data['address'];
        segment_id = data['segment_id'];
        target_address = data['target_address'];
        unwrapped = data['unwrapped'];
        source_id = concat_arrays([address, segment_id]);
        rewrapper_instance = (ref$ = this$._rewrapper_instances.get(source_id)) != null ? (ref1$ = ref$.get(target_address)) != null ? ref1$[0] : void 8 : void 8;
        if (!rewrapper_instance) {
          return;
        }
        data['wrapped'] = rewrapper_instance['wrap'](unwrapped);
      })['on']('unwrap', function(data){
        var address, segment_id, target_address, wrapped, source_id, rewrapper_instance, ref$, ref1$;
        if (this$._destroyed) {
          return;
        }
        address = data['address'];
        segment_id = data['segment_id'];
        target_address = data['target_address'];
        wrapped = data['wrapped'];
        source_id = concat_arrays([address, segment_id]);
        rewrapper_instance = (ref$ = this$._rewrapper_instances.get(source_id)) != null ? (ref1$ = ref$.get(target_address)) != null ? ref1$[1] : void 8 : void 8;
        if (!rewrapper_instance) {
          return;
        }
        data['unwrapped'] = rewrapper_instance['unwrap'](wrapped);
      });
    }
    Router.prototype = {
      /**
       * Process routing packet coming from node with specified ID
       *
       * @param {!Uint8Array} node_id
       * @param {!Uint8Array} packet
       */
      'process_packet': function(node_id, packet){
        if (this._destroyed) {
          return;
        }
        this._ronion['process_packet'](node_id, packet);
      }
      /**
       * Construct routing path through specified nodes
       *
       * @param {!Array<!Uint8Array>} nodes IDs of the nodes through which routing path must be constructed, last node in the list is responder
       *
       * @return {!Promise} Will resolve with ID of the route or will be rejected if path construction fails
       */,
      'construct_routing_path': function(nodes){
        var this$ = this;
        if (this._destroyed) {
          return Promise.reject();
        }
        nodes = nodes.slice();
        return new Promise(function(resolve, reject){
          var last_node_in_routing_path, first_node, encryptor_instances, rewrapper_instances, fail, x25519_public_key, first_node_encryptor_instance, segment_establishment_timeout, route_id, source_id;
          last_node_in_routing_path = nodes[nodes.length - 1];
          first_node = nodes.shift();
          encryptor_instances = ArrayMap();
          rewrapper_instances = ArrayMap();
          fail = function(){
            this$._destroy_routing_path(first_node, route_id);
            reject('Routing path creation failed');
          };
          x25519_public_key = detoxCrypto['convert_public_key'](first_node);
          if (!x25519_public_key) {
            fail();
            return;
          }
          first_node_encryptor_instance = detoxCrypto['Encryptor'](true, x25519_public_key);
          encryptor_instances.set(first_node, first_node_encryptor_instance);
          function create_response_handler(address, segment_id, command_data){
            var e, current_node, current_node_encryptor_instance, segment_extension_timeout;
            if (!are_arrays_equal(first_node, address) || !are_arrays_equal(route_id, segment_id)) {
              return;
            }
            clearTimeout(segment_establishment_timeout);
            this$._ronion['off']('create_response', create_response_handler);
            try {
              first_node_encryptor_instance['put_handshake_message'](command_data);
            } catch (e$) {
              e = e$;
              fail();
              return;
            }
            if (!first_node_encryptor_instance['ready']()) {
              fail();
              return;
            }
            rewrapper_instances.set(first_node, first_node_encryptor_instance['get_rewrapper_keys']().map(detoxCrypto['Rewrapper']));
            this$._ronion['confirm_outgoing_segment_established'](first_node, route_id);
            this$._multiplexers.set(source_id, fixedSizeMultiplexer['Multiplexer'](MAX_DATA_SIZE, this$._max_packet_data_size));
            this$._demultiplexers.set(source_id, fixedSizeMultiplexer['Demultiplexer'](MAX_DATA_SIZE, this$._max_packet_data_size));
            function extend_request(){
              var x25519_public_key;
              if (!nodes.length) {
                this$._established_routing_paths.set(source_id, [first_node, route_id]);
                resolve(route_id);
                return;
              }
              function extend_response_handler(address, segment_id, command_data){
                var e;
                if (!are_arrays_equal(first_node, address) || !are_arrays_equal(route_id, segment_id)) {
                  return;
                }
                this$._ronion['off']('extend_response', extend_response_handler);
                clearTimeout(segment_extension_timeout);
                if (!command_data.length) {
                  fail();
                  return;
                }
                try {
                  current_node_encryptor_instance['put_handshake_message'](command_data);
                } catch (e$) {
                  e = e$;
                  fail();
                  return;
                }
                if (!current_node_encryptor_instance['ready']()) {
                  fail();
                  return;
                }
                rewrapper_instances.set(current_node, current_node_encryptor_instance['get_rewrapper_keys']().map(detoxCrypto['Rewrapper']));
                this$._ronion['confirm_extended_path'](first_node, route_id);
                extend_request();
              }
              this$._ronion['on']('extend_response', extend_response_handler);
              current_node = nodes.shift();
              x25519_public_key = detoxCrypto['convert_public_key'](current_node);
              if (!x25519_public_key) {
                fail();
                return;
              }
              current_node_encryptor_instance = detoxCrypto['Encryptor'](true, x25519_public_key);
              encryptor_instances.set(current_node, current_node_encryptor_instance);
              segment_extension_timeout = timeoutSet(this$._routing_path_segment_timeout, function(){
                this$._ronion['off']('extend_response', extend_response_handler);
                fail();
              });
              this$._ronion['extend_request'](first_node, route_id, current_node, current_node_encryptor_instance['get_handshake_message']());
            }
            extend_request();
          }
          this$._ronion['on']('create_response', create_response_handler);
          segment_establishment_timeout = timeoutSet(this$._routing_path_segment_timeout, function(){
            this$._ronion['off']('create_response', create_response_handler);
            fail();
          });
          route_id = this$._ronion['create_request'](first_node, first_node_encryptor_instance['get_handshake_message']());
          source_id = concat_arrays([first_node, route_id]);
          this$._encryptor_instances.set(source_id, encryptor_instances);
          this$._rewrapper_instances.set(source_id, rewrapper_instances);
          this$._last_node_in_routing_path.set(source_id, last_node_in_routing_path);
        });
      }
      /**
       * Destroy routing path constructed earlier
       *
       * @param {!Uint8Array} node_id		First node in routing path
       * @param {!Uint8Array} route_id	Identifier returned during routing path construction
       */,
      'destroy_routing_path': function(node_id, route_id){
        this._destroy_routing_path(node_id, route_id);
      }
      /**
       * Max data size that will fit into single packet without fragmentation
       *
       * @return {number}
       */,
      'get_max_packet_data_size': function(){
        return this._max_packet_data_size;
      }
      /**
       * Send data to the responder on specified routing path
       *
       * @param {!Uint8Array}	node_id		First node in routing path
       * @param {!Uint8Array}	route_id	Identifier returned during routing path construction
       * @param {number}		command		Command from range `0..245`
       * @param {!Uint8Array}	data
       */,
      'send_data': function(node_id, route_id, command, data){
        var source_id, target_address, multiplexer, data_block;
        if (this._destroyed) {
          return;
        }
        if (data.length > MAX_DATA_SIZE) {
          return;
        }
        source_id = concat_arrays([node_id, route_id]);
        target_address = this._last_node_in_routing_path.get(source_id);
        multiplexer = this._multiplexers.get(source_id);
        if (!multiplexer) {
          return;
        }
        multiplexer['feed'](data);
        while (multiplexer['have_more_blocks']()) {
          data_block = multiplexer['get_block']();
          this._ronion['data'](node_id, route_id, target_address, command, data_block);
        }
      }
      /**
       * Destroy all of the routing path constructed earlier
       */,
      'destroy': function(){
        var this$ = this;
        if (this._destroyed) {
          return;
        }
        this._destroyed = true;
        this._established_routing_paths.forEach(function(arg$){
          var address, segment_id;
          address = arg$[0], segment_id = arg$[1];
          this$._destroy_routing_path(address, segment_id);
        });
      }
      /**
       * @param {!Uint8Array} address
       * @param {!Uint8Array} segment_id
       */,
      _destroy_routing_path: function(address, segment_id){
        var source_id, encryptor_instances;
        source_id = concat_arrays([address, segment_id]);
        encryptor_instances = this._encryptor_instances.get(source_id);
        if (!encryptor_instances) {
          return;
        }
        encryptor_instances.forEach(function(encryptor_instance){
          encryptor_instance['destroy']();
        });
        this._encryptor_instances['delete'](source_id);
        this._rewrapper_instances['delete'](source_id);
        this._last_node_in_routing_path['delete'](source_id);
        this._multiplexers['delete'](source_id);
        this._demultiplexers['delete'](source_id);
        this._established_routing_paths['delete'](source_id);
      }
    };
    Router.prototype = Object.assign(Object.create(asyncEventer.prototype), Router.prototype);
    Object.defineProperty(Router.prototype, 'constructor', {
      value: Router
    });
    return {
      'ready': detoxCrypto['ready'],
      'Router': Router,
      'MAX_DATA_SIZE': MAX_DATA_SIZE
    };
  }
  if (typeof define === 'function' && define['amd']) {
    define(['@detox/crypto', '@detox/transport', '@detox/utils', 'ronion', 'fixed-size-multiplexer', 'async-eventer'], Wrapper);
  } else if (typeof exports === 'object') {
    module.exports = Wrapper(require('@detox/crypto'), require('@detox/transport'), require('@detox/utils'), require('ronion'), require('fixed-size-multiplexer'), require('async-eventer'));
  } else {
    this['detox_transport'] = Wrapper(this['detox_crypto'], this['detox_transport'], this['detox_utils'], this['ronion'], this['fixed_size_multiplexer'], this['async_eventer']);
  }
}).call(this);
