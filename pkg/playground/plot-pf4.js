import React from 'react';
import ReactDOM from "react-dom";
import { ChartArea, ChartContainer, ChartGroup, ChartLabel, ChartVoronoiContainer } from '@patternfly/react-charts';

const Sparkline = () => {
    return (
        <>
            <h3>Vertical</h3>
            <div className="sparky">
                <div style={{ height: '100px', width: '400px' }}>
                    <ChartGroup
                        ariaDesc="Average number of pets"
                        ariaTitle="Sparkline chart example"
                        containerComponent={<ChartVoronoiContainer labels={({ datum }) => `${datum.name}: ${datum.y}`} constrainToVisibleArea />}
                        height={100}
                        maxDomain={{ y: 9 }}
                        padding={0}
                        width={400}
                    >
                        <ChartArea
                            data={[
                                { name: 'Cats', x: '2015', y: 3 },
                                { name: 'Cats', x: '2016', y: 4 },
                                { name: 'Cats', x: '2017', y: 8 },
                                { name: 'Cats', x: '2018', y: 6 }
                            ]}
                            horizontal={false}
                        />
                    </ChartGroup>
                </div>
                <ChartContainer>
                    <ChartLabel text="CPU utilization" dy={15} />
                </ChartContainer>
            </div>
            <h3>Horizontal</h3>
            <div className="sparky">
                <div style={{ height: '100px', width: '400px' }}>
                    <ChartGroup
                        ariaDesc="Average number of pets"
                        ariaTitle="Sparkline chart example"
                        containerComponent={<ChartVoronoiContainer labels={({ datum }) => `${datum.name}: ${datum.y}`} constrainToVisibleArea />}
                        height={100}
                        maxDomain={{ y: 9 }}
                        padding={0}
                        width={400}
                    >
                        <ChartArea
                            data={[
                                { name: 'Cats', x: '2015', y: 3 },
                                { name: 'Cats', x: '2016', y: 4 },
                                { name: 'Cats', x: '2017', y: 8 },
                                { name: 'Cats', x: '2018', y: 6 }
                            ]}
                            horizontal
                        />
                    </ChartGroup>
                </div>
                <ChartContainer>
                    <ChartLabel text="CPU utilization" dy={15} />
                </ChartContainer>
            </div>
        </>
    );
};

document.addEventListener("DOMContentLoaded", function() {
    ReactDOM.render(<Sparkline />, document.getElementById('plot_sparkline'));
});
