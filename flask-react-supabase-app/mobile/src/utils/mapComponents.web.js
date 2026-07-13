import React from 'react';
import { View } from 'react-native';

const MapView = ({ children, ...props }) => <View {...props}>{children}</View>;
const Marker = () => null;

export { MapView as default, Marker };
